# Camera xi nhan 0.3.1 (BMW iDrive 7 / MGU)

Bật xi nhan bên nào, đồng hồ (instrument cluster) hiện camera gương bên đó, kiểu Hyundai/Kia. Tắt xi nhan thì hình giữ thêm 2 giây rồi tự ẩn. Bật đèn khẩn cấp (hazard) thì không hiện.

Viết cho BMW G30 LCI 2021, iDrive 7, có camera 360 và đã cài MGU Store. Hình lấy từ chính luồng 4 camera mà Drive Recorder Next đang dùng, nên hai app chạy song song được.

> **Trên xe (G30, bản 0.3.0):** app đọc được xi nhan, hộp camera vào đúng chế độ `DR_ACTIVE/MODE_MOSAIK/7`, trợ thủ nhận và giải mã được luồng, cluster-render sẵn sàng. Luồng của G30 là **1280x480, 30 hình/giây**: hai loại khung xen kẽ, mỗi khung 2 camera. Bản 0.3.1 ghép hai khung đó thành hình 4 camera rồi mới cắt. **Phần ghép và hình trên đồng hồ chưa được xác nhận trên xe.**

## Gồm những gì

| Thành phần | Tên trong Store | Làm gì |
|---|---|---|
| App | **Camera xi nhan** (`xinhan_cam`) | Đọc xi nhan, giữ hộp camera ở chế độ 4 camera, quyết định lúc nào hiện bên nào. Tự chạy nền cùng đầu xe. Có trang trạng thái, nút thử và cài đặt |
| Công cụ (root) | **Trợ thủ Camera xi nhan** (`xinhan-cam`) | Nhận luồng camera, giải mã, cắt đúng camera gương và vẽ lên đồng hồ qua cluster-render. Tự cài kèm app |

Cần sẵn trên xe: **cluster-render** 0.5.10 trở lên (nguồn `robertnisipeanu/idrive-apps`, thường đã có nếu đang dùng bản đồ trên đồng hồ). Store tự cài/cập nhật nếu thiếu.

## Cài đặt

1. **MGU Store → Settings → Sources**: nguồn `marilykinson-glitch/id7-sideview-test`, nhánh `main` (đã thêm từ bản thử trước thì chỉ cần làm mới).
2. Cài **Camera xi nhan**. Store cài luôn công cụ **Trợ thủ Camera xi nhan**.
3. **Khởi động lại màn hình** (giữ nút nguồn/âm lượng khoảng 30 giây, hoặc khóa xe chờ xe ngủ). Công cụ mới chỉ chạy từ lần khởi động sau.
4. Trên đồng hồ: **Vùng hiển thị giữa = Bản đồ** (Instrument cluster → Central display area → Map view), như khi dùng bản đồ trên đồng hồ.
5. Gỡ app thử cũ **ID7 Side View Test** nếu còn.

## Thử lần đầu (xe đỗ, nổ máy hoặc bật điện)

Mở app **Camera xi nhan**. Chờ khoảng 15 giây sau khi đầu xe khởi động xong, rồi đọc 5 dòng trên cùng:

| Dòng | Khi ổn sẽ ghi |
|---|---|
| Trạng thái | `Chờ xi nhan` |
| Xi nhan | `Tắt (Đã kết nối, ...)` |
| Hộp camera | `DR_ACTIVE/MODE_MOSAIK/7` (hoặc 9, 10) `- đúng chế độ` |
| Luồng camera | `1280x480, 30 hình/giây, ghép 2 khung xen kẽ (sei@N)` trên G30; xe khác có thể là `1280x960, 15 hình/giây` |
| Đồng hồ | `sẵn sàng, map 512x384` |

Sau đó:

1. Bấm **Thử xem cả 4 camera**. Đồng hồ phải hiện hình ghép 4 camera trong 15 giây. Nhìn xem camera gương trái và phải nằm ở ô nào.
2. Bấm **Thử camera TRÁI**, rồi **Thử camera PHẢI**. Nếu ra sai camera, vào **Cài đặt** chỉnh hai mục *Camera gương TRÁI/PHẢI nằm ở ô nào*.
3. Bật xi nhan trái, phải, hazard, tắt.

Nếu hình bị nghiêng, ngược hay bị bóp hẹp: chỉnh *Xoay hình*, *Lật hình như soi gương*, *Kéo giãn ngang* trong Cài đặt. Đổi là có tác dụng ngay, không cần cài lại.

## Cài đặt trong app

| Mục | Mặc định | Ghi chú |
|---|---|---|
| Camera theo xi nhan | Bật | Tắt thì chỉ còn nút thử |
| Giữ hình sau khi tắt xi nhan | 2 giây | 1, 2, 3, 5 giây |
| Gạt nhẹ xi nhan (nháy 3 lần) | Cũng hiện camera | |
| Cỡ hình | Vừa (512x384) | Nhỏ 384x288, Lớn 640x480 |
| Vị trí hình | Giữa | Hoặc lệch về bên xi nhan, sát trên, sát dưới |
| Hiện ở đâu | Vùng bản đồ giữa đồng hồ | Phủ toàn đồng hồ và HUD là thử nghiệm |
| Camera gương TRÁI / PHẢI nằm ở ô nào | Dưới trái / Dưới phải | Theo hình ghép 4 camera |
| Hình 4 camera bị đảo hàng trên/dưới | Không | Bật *Đảo lại* nếu nút *Thử xem cả 4 camera* cho thấy cặp gương nằm hàng trên. Nếu dòng Luồng camera ghi `(count)` thay vì `(sei@N)` thì hai hàng có thể tự đổi chỗ sau khi mất khung: báo lại kèm ảnh dòng cuối |
| Xoay hình camera trái / phải | Không | 90, 180, 270 độ |
| Lật hình như soi gương | Không | |
| Phóng to phần giữa hình | Không | 1,25 / 1,5 / 2 lần |
| Kéo giãn ngang | Không | Dùng khi hình bị bóp hẹp |
| Số hình mỗi giây | 12 | Thấp hơn thì nhẹ đường truyền lên đồng hồ |
| Chỉ hiện khi xe chạy chậm hơn | Mọi tốc độ | 30 / 50 / 80 km/h |
| Cách lấy hình | Cắt từ hình 4 camera | *Yêu cầu riêng camera gương*: nét hơn (1280x480) nhưng đổi chế độ hộp camera mỗi lần xi nhan, Drive Recorder sẽ mất hình các camera khác trong lúc đó. Thử nghiệm |
| Bật chế độ camera của xe | Tự bật khi cần | Chọn *Không* nếu muốn chỉ Drive Recorder điều khiển hộp camera |
| Lớp video trên đồng hồ | Giữ sẵn | Đổi sang *Tạo mỗi lần xi nhan* nếu đồng hồ báo từ chối lớp video |

## Nếu không lên hình

Mở app, **chụp 6 dòng trạng thái** (kể cả dòng cuối có số bản) và gửi lại. Bảng dưới là các trường hợp hay gặp:

| Dòng trên trang | Nghĩa là | Làm gì |
|---|---|---|
| Luồng camera: `Trợ thủ xinhan-cam chưa chạy` | Công cụ chưa cài hoặc chưa khởi động lại màn hình | Cài công cụ trong Store, khởi động lại màn hình |
| Luồng camera: `Trợ thủ: mgu-sidecam cannot start on this head unit: ...` | Chương trình giải mã không chạy được trên firmware này | Chụp nguyên dòng đó gửi lại |
| Luồng camera: `chưa có hình (chưa nối được: ...)` | Chưa vào được luồng AVB của xe | Chụp dòng đó |
| Luồng camera: `chưa có hình (đã nối, hộp camera chưa phát)` | Hộp camera chưa ở chế độ phát | Xem dòng Hộp camera |
| Hộp camera: `... - xe chưa cho, chờ thử lại` | Hộp camera không nhận yêu cầu 4 camera | Mở Drive Recorder Next, chọn *All cameras*; hoặc chụp dòng đó |
| Hộp camera: `chưa nối (...)` | App chưa được cấp giao tiếp camera | Chụp dòng đó |
| Đồng hồ: `chưa nối được cluster-render` | Thiếu cluster-render | Cài từ nguồn `robertnisipeanu/idrive-apps` |
| Đồng hồ: `từ chối lớp video - too many video buffers...` | Đồng hồ đang giữ 2 video (bản đồ trên đồng hồ + HUD) | Cài đặt → *Lớp video* = *Tạo mỗi lần xi nhan*; hoặc để bản đồ chỉ ở đồng hồ hoặc chỉ ở HUD |
| Mọi dòng đều ổn nhưng đồng hồ không hiện | Vùng giữa đồng hồ không ở chế độ Bản đồ | Bước 4 phần Cài đặt |
| Hình hiện nhưng chớp qua lại giữa các camera | Hộp camera xen kẽ nhiều kiểu khung hình | Chụp dòng cuối (có mã `SEI`) gửi lại |

Log chi tiết nếu có SSH: `/var/opt/xinhan-cam/xinhan-cam.log`, `journalctl -u xinhan-cam`, và `/run/xinhan-cam/status.json`.

## Cách hoạt động

```
xi nhan (SOME/IP de.bmw.body.Light)
        │
        ▼
app Camera xi nhan ──► hộp camera: DR_ACTIVE / MODE_MOSAIK / 7  (ICAM2Proxy, như Drive Recorder)
        │  data/control.json: { view: left|right|all|none, config }
        ▼
trợ thủ xinhan-cam (root) ──► mgu-sidecam
        luồng AVB media_transport.avb_streaming.1 (H.264; G30: 1280x480, hai khung xen kẽ, mỗi khung 2 camera)
        → giải mã (FFmpeg, phần mềm) → ghép 2 khung thành hình 4 camera → cắt 1/4 hình, xoay, co
        → cluster-render → đồng hồ
```

An toàn khi có sự cố:

- Hình chỉ hiện khi khung hình mới hơn 0,8 giây. Luồng dừng là ẩn ngay, không bao giờ để hình đứng trên đồng hồ.
- App phải xác nhận lại 2 lần mỗi giây. App dừng, treo hay bị gỡ thì hình tự tắt trong khoảng 2 giây.
- Khi xe vào số lùi hoặc mở camera đỗ xe, app nhường camera cho xe và không hiện gì.
- App chỉ gửi yêu cầu cho hộp camera khi cần; hộp camera không theo thì sau 4 lần sẽ nghỉ 1 phút, không giành với app khác.
- Không ghi gì vào xe, không coding, không sửa file hệ thống.

## Đã kiểm tra gì

Chạy được trên máy tính (Linux x86-64), không cần xe:

```sh
FFMPEG_SRC=/duong/dan/FFmpeg-n7.1 native/build.sh test   # build binary cho đầu xe + test binary đó
node tests/logic_test.js                                 # logic của app
python3 tests/system_test.py                             # app + trợ thủ + binary + đồng hồ giả
NODE_PATH=<nơi có acorn> node scripts/check_node8.js     # cú pháp Node 8 của đầu xe
```

| Đã kiểm tra | Bằng cách nào |
|---|---|
| Binary chỉ dùng hàm có trong glibc 2.27 của đầu xe | `native/toolchain/check_abi.py` đối chiếu từng symbol với danh sách ABI của glibc 2.27 |
| Binary chạy được trên glibc 2.27 thật | Tự build glibc 2.27 từ mã nguồn, chạy chính file `tools/xinhan-cam/mgu-sidecam` bằng `ld.so` 2.27 đó: toàn bộ `native/test/e2e.py` pass (`SIDECAM_LOADER`, `SIDECAM_LIBPATH`) |
| Nhận gói RTP H.264 → giải mã → cắt đúng camera → gửi đúng khung cho cluster-render | Luồng 4 camera giả (4 ô màu) qua thư viện AVB giả, cluster-render giả đọc lại màu từng ô |
| Luồng không có khung IDR (intra refresh), mất gói, vào luồng giữa chừng | Như trên, với các luồng lỗi |
| Xi nhan trái/phải/hazard/tắt, nháy từng nhịp, giữ hình, giới hạn tốc độ, nút thử, đổi cài đặt lúc đang hiện | `tests/system_test.py` chạy đúng mã app trên bộ kit giả |
| App chết, binary chết, trợ thủ dừng, cluster-render khởi động lại, cluster-render từ chối lớp video | `tests/system_test.py`, `native/test/e2e.py` |
| Gói app build được bằng kit | `python3 kit/tools/build.py xinhan_cam` |

**Chưa kiểm tra được vì cần xe:**

- Hai khung xen kẽ của G30 có đúng là 2 cặp camera không, và thẻ SEI có phân biệt được chúng không (nếu không, trợ thủ đếm chẵn/lẻ).
- Bố cục thật của hình 4 camera sau khi ghép (ô nào là gương trái/phải, hình có bị xoay hay bóp không). Có cài đặt để chỉnh.
- Hình có thật sự lên đồng hồ không.
- Tải CPU khi giải mã phần mềm 1280x960 trên đầu xe.
- Độ trễ thật từ lúc bật xi nhan tới lúc đồng hồ lên hình (trên máy thử: dưới 0,1 giây chưa tính đồng hồ).

## Mã nguồn và giấy phép

| Thư mục | Nội dung | Giấy phép |
|---|---|---|
| `apps/xinhan_cam/` | App (main.js, logic.js, camera.js) | MIT |
| `tools/xinhan-cam/` | Trợ thủ (xinhan-cam.js: MIT) và binary `mgu-sidecam` | Binary: GPL-3.0-or-later, xem `tools/xinhan-cam/NOTICE.md` |
| `native/` | Mã nguồn đầy đủ của `mgu-sidecam`, script build, test | GPL-3.0-or-later |
| `native/third_party/idrive-apps/` | Bộ nhận AVB, tách gói RTP, client cluster-render của [robertnisipeanu/idrive-apps](https://github.com/robertnisipeanu/idrive-apps) | GPL-3.0-or-later / MPL-2.0 |
| `kit/` | App kit của [cauliflowermossgrape/idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) (qua eroobeeroo/idrive7-cluster-info) | MIT |

Cách gọi hộp camera (ICAM2Proxy, DR_ACTIVE / MODE_MOSAIK, các số perspective) và tên luồng AVB là thông tin giao tiếp của xe, đối chiếu từ ghi chú công khai trong [IterioDev/car-apps](https://github.com/IterioDev/car-apps) (Drive Recorder Next, Turn View). Không có mã nào của IterioDev trong repo này.

Build lại binary: xem `native/build.sh` và `native/toolchain/README.md`.
