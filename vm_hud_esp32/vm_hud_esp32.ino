/*
 * vm_hud_esp32.ino - Virtual VietMap HUD (`HUD(BLE)`) Bridge for BMW MGU iDrive 7 (`bimmer-drive`)
 *
 * Boards: ESP32-C6 SuperMini (khuyên dùng), ESP32-C3, ESP32-S3, ESP32 (Arduino-ESP32 3.x).
 *   - Phát BLE GATT Service 0000FFF0-0000-1000-8000-00805F9B34FB tên "HUD(BLE)"
 *   - Notify: 0000FFF1-...  |  Write: 0000FFF2-...
 *   - Tự bắt tay với VietMap Live (cmd 0x0E -> MODEL:H1N...PROTOCOL:2.2.2)
 *   - Xuất JSON qua USB Serial (115200) cho `bimmer-drive`:
 *       {"t":"vmhud","v":1,"limit":60,"next":50,"dist":200,"camType":1,"connected":true,"model":"H1N"}
 *   - RAW_LOG=1: in thêm mọi byte VietMap gửi / ESP32 trả về dạng
 *       {"t":"raw","dir":"rx","ms":1234,"hex":"a55a37c3..."}
 *     bimmer-drive bỏ qua dòng "raw", nên để bật khi cắm trên xe cũng không sao.
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define RAW_LOG 1

#define SERVICE_UUID   "0000fff0-0000-1000-8000-00805f9b34fb"
#define NOTIFY_UUID    "0000fff1-0000-1000-8000-00805f9b34fb"
#define WRITE_UUID     "0000fff2-0000-1000-8000-00805f9b34fb"
/* VIETMAP LIVE 3.4.5 lists, in its HUD search, only devices whose name contains
 * "vietmap_" / "vietmap-"; a BLE-only one must also contain "h50" (the H50
 * HUD, Java handler Da/j: service FFFF, characteristics 9ABC + 1234). */
#define DEVICE_NAME    "vietmap-hud"

static BLECharacteristic* pNotifyChar = nullptr;     /* FFF1 (old HUD) */
static BLECharacteristic* pHm10Char = nullptr;       /* FFE1 (HM-10 style: notify + write) */
static BLECharacteristic* pTxChar = nullptr;
static BLECharacteristic* pH50A = nullptr;          /* 9ABC */
static BLECharacteristic* pH50B = nullptr;          /* 1234 */         /* where replies go: the one the phone wrote to */
static volatile bool bleConnected = false;
static volatile bool sendWelcomePending = false;
static unsigned long connectedAtMs = 0;
static unsigned long lastEmitMs = 0;
static unsigned long lastCamMs = 0;
static uint32_t camFrames = 0;

static uint8_t rxBuf[1024];
static size_t rxLen = 0;

static int currentLimit = 0;
static int nextLimit = 0;
static int currentDist = 0;
static int currentCamType = 0;

/* ---- Hàng đợi gửi: không gửi BLE ngay trong callback onWrite ---- */
struct TxItem { uint8_t cmd; uint8_t len; uint8_t body[64]; };
static TxItem txQ[8];
static volatile uint8_t txHead = 0, txTail = 0;
static portMUX_TYPE txMux = portMUX_INITIALIZER_UNLOCKED;

static void queueTx(uint8_t cmd, const uint8_t* body, size_t len) {
    if (len > sizeof(txQ[0].body)) return;
    portENTER_CRITICAL(&txMux);
    uint8_t next = (txHead + 1) & 7;
    if (next != txTail) {
        txQ[txHead].cmd = cmd;
        txQ[txHead].len = (uint8_t)len;
        if (len && body) memcpy(txQ[txHead].body, body, len);
        txHead = next;
    }
    portEXIT_CRITICAL(&txMux);
}

static void logHex(const char* dir, const uint8_t* data, size_t n) {
#if RAW_LOG
    static const char* H = "0123456789abcdef";
    Serial.printf("{\"t\":\"raw\",\"dir\":\"%s\",\"ms\":%lu,\"n\":%u,\"hex\":\"", dir, millis(), (unsigned)n);
    for (size_t i = 0; i < n; i++) { Serial.write(H[data[i] >> 4]); Serial.write(H[data[i] & 15]); }
    Serial.print("\"}\n");
#endif
}

static void sendC3Frame(uint8_t cmd, const uint8_t* body, size_t bodyLen) {
    BLECharacteristic* tx = pTxChar ? pTxChar : pNotifyChar;
    if (!tx || !bleConnected) return;
    size_t lenField = bodyLen + 13;
    size_t total = lenField + 8;
    if (total > 256) return;
    uint8_t frame[256];
    memset(frame, 0, total);
    frame[0] = 0xA5; frame[1] = 0x5A; frame[2] = 0x37; frame[3] = 0xC3;
    frame[4] = (lenField >> 24) & 0xFF; frame[5] = (lenField >> 16) & 0xFF;
    frame[6] = (lenField >> 8) & 0xFF;  frame[7] = lenField & 0xFF;
    uint32_t sec = (uint32_t)(millis() / 1000UL);
    frame[8] = (sec >> 24) & 0xFF; frame[9] = (sec >> 16) & 0xFF;
    frame[10] = (sec >> 8) & 0xFF; frame[11] = sec & 0xFF;
    frame[12] = cmd;
    if (bodyLen > 0 && body != nullptr) memcpy(frame + 13, body, bodyLen);
    logHex("tx", frame, total);
    for (size_t off = 0; off < total; off += 20) {
        size_t chunk = total - off;
        if (chunk > 20) chunk = 20;
        tx->setValue(frame + off, chunk);
        tx->notify();
        delay(15);
    }
}

static void sendHudInfo() {
    const char* info = "MODEL:H1N,HW:1.0,FW:1.0,PROTOCOL:2.2.2,OBDV:1_1,SID:0";
    sendC3Frame(0x0E, (const uint8_t*)info, strlen(info));
}

static void emitJson() {
    lastEmitMs = millis();
    long camAge = lastCamMs ? (long)(millis() - lastCamMs) : -1;
    Serial.printf(
        "{\"t\":\"vmhud\",\"v\":1,\"limit\":%d,\"next\":%d,\"dist\":%d,\"camType\":%d,\"connected\":%s,\"model\":\"H1N\",\"camAgeMs\":%ld,\"camFrames\":%lu}\n",
        currentLimit, nextLimit, currentDist, currentCamType,
        bleConnected ? "true" : "false", camAge, (unsigned long)camFrames);
}

static void handleCameraTuples(const uint8_t* data, size_t count) {
    if (count == 0) return;
    lastCamMs = millis();
    camFrames++;
    int bestSpeed = 0, bestDist = 999999, bestType = data[0];
    int altSpeed = 0, altDist = 999999;
    for (size_t i = 0; i < count; i++) {
        uint8_t ctype = data[i * 4];
        uint16_t dist = ((uint16_t)data[i * 4 + 1] << 8) | data[i * 4 + 2];
        uint8_t spd = data[i * 4 + 3];
        if (spd >= 5 && spd <= 199) {
            if (dist == 0 && (bestSpeed == 0 || bestDist != 0)) { bestSpeed = spd; bestDist = 0; bestType = ctype; }
            else if (dist < bestDist) { bestSpeed = spd; bestDist = dist; bestType = ctype; }
        }
    }
    if (bestSpeed > 0) {
        for (size_t i = 0; i < count; i++) {
            uint16_t dist = ((uint16_t)data[i * 4 + 1] << 8) | data[i * 4 + 2];
            uint8_t spd = data[i * 4 + 3];
            if (spd >= 5 && spd <= 199 && spd != bestSpeed && dist > 0 && dist < altDist) { altSpeed = spd; altDist = dist; }
        }
    }
    currentLimit = bestSpeed;
    nextLimit = altSpeed;
    currentDist = (bestSpeed > 0 && bestDist < 999999) ? bestDist : ((int)((data[1] << 8) | data[2]));
    currentCamType = bestType;
    emitJson();
}

static void parseRxBuffer() {
    while (rxLen >= 4) {
        size_t syncIdx = rxLen;
        for (size_t i = 0; i + 3 < rxLen; i++) {
            if (rxBuf[i] == 0xA5 && rxBuf[i + 1] == 0x5A && rxBuf[i + 2] == 0x37 &&
                (rxBuf[i + 3] == 0xC3 || rxBuf[i + 3] == 0xC5)) { syncIdx = i; break; }
        }
        if (syncIdx == rxLen) {
            if (rxLen > 3) { memmove(rxBuf, rxBuf + (rxLen - 3), 3); rxLen = 3; }
            return;
        }
        if (syncIdx > 0) { memmove(rxBuf, rxBuf + syncIdx, rxLen - syncIdx); rxLen -= syncIdx; }
        if (rxLen < 8) return;

        uint32_t lenVal = ((uint32_t)rxBuf[4] << 24) | ((uint32_t)rxBuf[5] << 16) |
                          ((uint32_t)rxBuf[6] << 8) | rxBuf[7];
        if (rxBuf[3] == 0xC5) {
            if (lenVal < 5 || lenVal > 800) { memmove(rxBuf, rxBuf + 1, rxLen - 1); rxLen--; continue; }
            size_t total = 4 + lenVal + 2;
            if (rxLen < total) return;
            uint8_t cmd = rxBuf[8];
            if (cmd == 0x01 && lenVal >= 9) handleCameraTuples(rxBuf + 9, 1);
            memmove(rxBuf, rxBuf + total, rxLen - total);
            rxLen -= total;
        } else {
            if (lenVal < 13 || lenVal > 900) { memmove(rxBuf, rxBuf + 1, rxLen - 1); rxLen--; continue; }
            size_t total = lenVal + 8;
            if (rxLen < total) return;
            uint8_t cmd = rxBuf[12];
            size_t bodyLen = total - 21;
            const uint8_t* body = rxBuf + 13;
            if (cmd == 0x01 && bodyLen >= 4) {
                handleCameraTuples(body, bodyLen / 4);
            } else if (cmd == 0x0E) {
                queueTx(0x0E, nullptr, 0);   /* 0x0E trong hàng đợi = gửi HUDInfo */
            } else if (cmd == 0x50) {
                uint8_t v = 0x64; queueTx(0x50, &v, 1);
            } else if (cmd == 0x51) {
                uint8_t v = 0x03; queueTx(0x51, &v, 1);
            } else if (cmd == 0x53) {
                uint8_t v[3] = {0x01, 0x00, 0x07}; queueTx(0x53, v, 3);
            }
            memmove(rxBuf, rxBuf + total, rxLen - total);
            rxLen -= total;
        }
    }
}

class ServerCB : public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) override {
        bleConnected = true;
        connectedAtMs = millis();
        sendWelcomePending = true;
        rxLen = 0;
        pTxChar = nullptr;
        Serial.print("{\"t\":\"raw\",\"dir\":\"evt\",\"hex\":\"\",\"evt\":\"connect\"}\n");
    }
    void onDisconnect(BLEServer* pServer) override {
        bleConnected = false;
        sendWelcomePending = false;
        currentLimit = 0; nextLimit = 0; rxLen = 0;
        Serial.print("{\"t\":\"raw\",\"dir\":\"evt\",\"hex\":\"\",\"evt\":\"disconnect\"}\n");
        emitJson();
        BLEDevice::startAdvertising();
    }
};

class WriteCB : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* pCharacteristic) override {
        pTxChar = (pCharacteristic == pHm10Char) ? pHm10Char : pNotifyChar;
        String val = pCharacteristic->getValue();
        size_t n = val.length();
        if (n == 0) return;
        const char* tag = pCharacteristic == pH50A ? "rx9abc" : pCharacteristic == pH50B ? "rx1234" :
                          pCharacteristic == pHm10Char ? "rxffe1" : "rxfff2";
        logHex(tag, (const uint8_t*)val.c_str(), n);
        if (rxLen + n > sizeof(rxBuf)) rxLen = 0;
        memcpy(rxBuf + rxLen, val.c_str(), n);
        rxLen += n;
        parseRxBuffer();
    }
};

void setup() {
    Serial.begin(115200);
    BLEDevice::init(DEVICE_NAME);
    BLEDevice::setMTU(200);

    BLEServer* pServer = BLEDevice::createServer();
    pServer->setCallbacks(new ServerCB());

    BLEService* pService = pServer->createService(BLEUUID((uint16_t)0xFFF0));
    pNotifyChar = pService->createCharacteristic(
        BLEUUID((uint16_t)0xFFF1), BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ);
    pNotifyChar->addDescriptor(new BLE2902());

    BLECharacteristic* pWriteChar = pService->createCharacteristic(
        BLEUUID((uint16_t)0xFFF2), BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
    pWriteChar->setCallbacks(new WriteCB());

    pService->start();

    /* HM-10 style service FFE0 with one characteristic FFE1 for both ways,
     * as the newer VIETMAP LIVE (3.4.x) builds its HUD UUIDs from ffe0/ffe1. */
    BLEService* pHm10 = pServer->createService(BLEUUID((uint16_t)0xFFE0));
    pHm10Char = pHm10->createCharacteristic(
        BLEUUID((uint16_t)0xFFE1),
        BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY |
        BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
    pHm10Char->addDescriptor(new BLE2902());
    pHm10Char->setCallbacks(new WriteCB());
    pHm10->start();

    /* H50 HUD (vietmap_hud_sdk, Da/j): service FFFF, characteristics 9ABC and 1234 */
    BLEService* pH50 = pServer->createService(BLEUUID((uint16_t)0xFFFF));
    const uint32_t allProps = BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY |
        BLECharacteristic::PROPERTY_INDICATE | BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR;
    pH50A = pH50->createCharacteristic(BLEUUID((uint16_t)0x9ABC), allProps);
    pH50A->addDescriptor(new BLE2902());
    pH50A->setCallbacks(new WriteCB());
    pH50B = pH50->createCharacteristic(BLEUUID((uint16_t)0x1234), allProps);
    pH50B->addDescriptor(new BLE2902());
    pH50B->setCallbacks(new WriteCB());
    pH50->start();
    /* Name and the 16-bit service UUID 0xFFF0 both in the primary advertising
     * packet (some apps' scanners never read the scan response), and again in
     * the scan response. */
    BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
    BLEAdvertisementData adv;
    adv.setFlags(0x06);   /* LE General Discoverable, BR/EDR not supported */
    adv.setCompleteServices(BLEUUID((uint16_t)0xFFF0));
    adv.setName(DEVICE_NAME);
    pAdvertising->setAdvertisementData(adv);
    BLEAdvertisementData scan;
    scan.setName(DEVICE_NAME);
    scan.setCompleteServices(BLEUUID((uint16_t)0xFFF0));
    /* both services are listed: FFE0 in the advertising packet, FFF0 in the scan response */
    pAdvertising->setScanResponseData(scan);
    pAdvertising->setMinPreferred(0x06);
    pAdvertising->setMinInterval(0x20);   /* 20 ms: found fast by a scanning phone */
    pAdvertising->setMaxInterval(0x40);
    BLEDevice::startAdvertising();
    emitJson();
}

void loop() {
    unsigned long now = millis();
    if (bleConnected && sendWelcomePending && (now - connectedAtMs >= 300)) {
        sendWelcomePending = false;
        sendHudInfo();
    }
    while (txTail != txHead) {
        TxItem it;
        portENTER_CRITICAL(&txMux);
        it = txQ[txTail];
        txTail = (txTail + 1) & 7;
        portEXIT_CRITICAL(&txMux);
        if (it.cmd == 0x0E && it.len == 0) { sendHudInfo(); emitJson(); }
        else sendC3Frame(it.cmd, it.body, it.len);
    }
    if (now - lastEmitMs >= 1000) emitJson();
    delay(10);
}
