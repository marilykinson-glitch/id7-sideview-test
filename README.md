# Camera xi nhan 0.5.0 (BMW iDrive 7 / MGU)

Bật xi nhan bên nào, đồng hồ (instrument cluster) hiện camera gương bên đó, kiểu Hyundai/Kia. Tắt xi nhan thì hình giữ thêm 2 giây rồi tự ẩn. Bật đèn khẩn cấp (hazard) thì không hiện.

Viết cho BMW G30 LCI 2021, iDrive 7, có camera 360 và đã cài MGU Store. Hình lấy từ chính luồng 4 camera mà Drive Recorder Next đang dùng, nên hai app chạy song song được.

> **Trên xe (G30, đến bản 0.3.3):** xi nhan thật bật đúng camera từng bên, hình tròn hiện trong vòng đồng hồ. Luồng của G30 là 1280x480, 30 hình/giây: hai loại khung xen kẽ, mỗi khung 2 camera, phân biệt bằng thẻ SEI (`sei@19`). **Chưa xác nhận trên xe (mới ở 0.4.0):** hướng nhìn "chếch về sau" có đúng là phía sau không, màn hình mới (chạm, trang Vị trí), camera trước giữa đồng hồ.

## Mới trong 0.5.0

Chưa phần nào của 0.5.0 được thử trên xe.

- **Tab Canh chỉnh.** Chọn *Gương trái*, *Gương phải* hoặc *Camera trước*; camera đó hiện trên đồng hồ suốt lúc mở tab.
  - Camera gương: dịch phần hình được lấy (lên, xuống, trái, phải) và phóng to riêng từng bên.
  - Camera trước: độ cao, chúc xuống, góc nhìn, lệch trái/phải, dịch ngang, độ cong mắt cá, phóng to. Trên hình có hai vạch vàng (mép làn rộng 3 m) và vạch ngang ở 5, 10, 20 m: chỉnh đến khi chúng nằm đúng trên mặt đường. Mũi tên dẫn đường dùng chính các số này.
- **Tab Dẫn đường: mũi tên trên camera trước.** Khi sắp tới chỗ rẽ (mặc định còn 250 m) camera trước hiện giữa đồng hồ, chevron xanh chạy trên mặt đường rồi bẻ vào hướng rẽ, ba mũi tên đứng ở chỗ rẽ, góc trên có thẻ mũi tên và khoảng cách. Chọn *Khi sắp rẽ*, *Suốt đường* hoặc *Tắt*. Nút *Xem thử 25 giây* vẽ một chỗ rẽ giả để xem hình dáng mà không cần dẫn đường.
  - Lệnh rẽ được trợ thủ đọc từ dịch vụ dẫn đường của chính đầu xe (giao diện `...Guidance`, trường `conclusiveDart`), chỉ đọc. Bản đồ BMW chắc chắn đưa dữ liệu vào đó. CarPlay và Android Auto thì tùy đầu xe có nhận lệnh rẽ của điện thoại hay không; trên iDrive 7 chưa ai xác nhận. Waze không gửi lệnh rẽ cho xe nên sẽ không có mũi tên.
  - Tab này hiện đang đọc được gì (dòng *Đọc dẫn đường*, *Nguồn*, *Lệnh kế tiếp*, *Dữ liệu thô*). Nhật ký đầy đủ: `/var/opt/xinhan-cam/nav.log` trên đầu xe.
  - Khác bản gốc BMW: xe chỉ cho biết "rẽ gì, còn bao xa", không cho hình dạng ngã rẽ, nên mũi tên đặt theo khoảng cách chứ không bám đúng mép đường; không có tên đường trên thẻ.

## Mới trong 0.4.0

- **Hướng nhìn như Hyundai/Kia.** Blind-Spot View Monitor của Hyundai/Kia chiếu vùng điểm mù phía SAU bên xi nhan. Bản trước lấy phần giữa hình camera gương nên nhìn ngang. Giờ mặc định lấy nửa hình hướng về đuôi xe (*Hướng nhìn: Chếch về sau*). Camera gương của BMW là camera góc rộng chĩa xuống, nên không nhìn xa về sau được như camera riêng của Hyundai. Nếu trên xe thấy hình lại hướng về đầu xe, đổi sang *Chếch về trước* (tức là giả định "mép nào là phía sau" của mình bị ngược).
- **Màn hình mới**, vẽ bằng bộ vẽ của kit (cần `idrive7-renderd` và `mgu-inputgate`, Store tự cài): sơ đồ đồng hồ cho thấy hình nằm ở đâu và sáng lên khi đang hiện, trạng thái chữ lớn, 4 dòng tình trạng có đèn xanh/vàng.
- **Trang Vị trí**: mở trang này thì camera bên đang chỉnh hiện luôn trên đồng hồ thật. Chạm vào sơ đồ để đặt hình vào đó, hoặc bấm Lên / Xuống / Ra ngoài / Vào giữa (mỗi lần 10 điểm), Nhỏ hơn / Lớn hơn, Tròn / Chữ nhật, Mặc định. Mỗi thay đổi thấy ngay trên đồng hồ. Hai bên đối xứng nhau.
- **Camera trước giữa đồng hồ** (thay cho Turn View): mục *Camera trước* = Tắt / Dưới 30 km/h / Dưới 60 km/h / Luôn hiện. Bật xi nhan thì camera gương thay chỗ, tắt xi nhan thì camera trước hiện lại. Không có mũi tên dẫn đường như Turn View của IterioDev (mã của họ giấy phép PolyForm Strict, không dùng lại được). Hai app không chạy cùng lúc được vì Turn View yêu cầu hộp camera chỉ phát camera trước; dùng mục này thì tắt hoặc gỡ Turn View.
- **Tên mục trong Cài đặt ngắn lại** để ô giá trị không che mất.

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

Mở app **Camera xi nhan**. Chờ khoảng 15 giây sau khi đầu xe khởi động xong. Bên phải màn hình là trạng thái chữ lớn và 4 dòng, mỗi dòng một đèn (xanh là ổn, vàng là có vấn đề):

| Dòng | Khi ổn sẽ ghi |
|---|---|
| (chữ lớn) | `CHỜ XI NHAN` |
| Xi nhan | `Tắt` |
| Hộp camera | `DR_ACTIVE/MODE_MOSAIK/7` (hoặc 9, 10) `· đúng chế độ` |
| Luồng hình | `1280x480 · 30 hình/giây · ghép 2 khung (sei@N)` trên G30; xe khác có thể là `1280x960 · 15 hình/giây` |
| Đồng hồ | `sẵn sàng · panel 320x320` |

Sau đó:

1. Bấm **4 camera**. Đồng hồ phải hiện hình ghép 4 camera trong 15 giây. Nhìn xem camera gương trái và phải nằm ở ô nào.
2. Bấm **Thử trái**, rồi **Thử phải** (bấm lần nữa để tắt sớm). Nếu ra sai camera, vào **Cài đặt** chỉnh *Ô cam trái / Ô cam phải*.
3. Bật xi nhan trái, phải, hazard, tắt.
4. Sang tab **Vị trí** để đặt hình cho vừa vòng đồng hồ: camera hiện sẵn trên đồng hồ trong lúc chỉnh.
5. Muốn có camera trước giữa đồng hồ: bấm nút **Camera trước** để đổi Tắt / Dưới 30 / Dưới 60 / Luôn hiện.

Nếu hình bị nghiêng, ngược hay bị bóp hẹp: chỉnh *Xoay cam*, *Lật gương*, *Giãn ngang* trong Cài đặt. Đổi là có tác dụng ngay, không cần cài lại.

## Cài đặt trong app

| Mục | Mặc định | Ghi chú |
|---|---|---|
| Bật theo xi nhan | Bật | Tắt thì chỉ còn nút thử |
| Camera trước | Tắt | Dưới 30 km/h, Dưới 60 km/h, Luôn hiện. Hiện ở vùng bản đồ giữa đồng hồ khi không xi nhan |
| Mũi tên dẫn đường | Khi sắp rẽ | Suốt đường, Tắt. Xem tab Dẫn đường |
| Thẻ rẽ | Hiện | Thẻ mũi tên + khoảng cách ở góc hình camera trước |
| Cỡ cam trước | Vừa (512x384) | Nhỏ 384x288, Lớn 640x480 |
| Hướng nhìn | Chếch về sau | Ngang (như bản 0.3), Chếch về trước |
| Phóng to | Không | 1,25 / 1,5 / 2 lần |
| Giữ hình thêm | 2 giây | Sau khi tắt xi nhan: 1, 2, 3, 5 giây |
| Gạt nhẹ 3 nháy | Có hiện | |
| Hình dạng | Tròn | Chữ nhật thì thấy hết hình |
| Cỡ hình | Vừa khít (320) | Nhỏ 288, Vừa 384, Lớn 480. Tròn: đường kính |
| Vị trí | Trong đồng hồ | Chỉnh tiếp bằng trang Vị trí của app. Hoặc giữa, sát mép, trên, dưới |
| Vùng hiện | Vùng bản đồ | Chỉ dùng khi Vị trí không phải "Trong đồng hồ". Toàn đồng hồ và HUD là thử nghiệm |
| Lật gương | Không | |
| Giới hạn tốc độ | Mọi tốc độ | Camera gương chỉ hiện khi chậm hơn 30 / 50 / 80 km/h |
| Ô cam trái / Ô cam phải | Dưới trái / Dưới phải | Camera gương nằm ở ô nào của hình 4 camera |
| Đảo hàng | Không | Bật nếu nút *4 camera* cho thấy cặp gương nằm hàng trên. Nếu dòng Luồng hình ghi `(count)` thay vì `(sei@N)` thì hai hàng có thể tự đổi chỗ sau khi mất khung: báo lại kèm ảnh |
| Xoay cam trái / phải | Không | 90, 180, 270 độ |
| Giãn ngang | Không | Dùng khi hình bị bóp hẹp |
| Hình/giây | 12 | Thấp hơn thì nhẹ đường truyền lên đồng hồ |
| Cách lấy hình | Cắt từ 4 cam | *Riêng cam gương*: nét hơn nhưng đổi chế độ hộp camera mỗi lần xi nhan, Drive Recorder mất hình các camera khác trong lúc đó. Thử nghiệm |
| Tự bật camera | Có | Chọn *Không* nếu muốn chỉ Drive Recorder điều khiển hộp camera |
| Lớp video | Giữ sẵn | Đổi sang *Tạo mỗi lần* nếu đồng hồ báo từ chối lớp video |
| Màu, Bố cục, Bộ vẽ | | Giao diện của app trên màn hình giữa |

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

- Vị trí "trong vòng đồng hồ" có nằm đúng giữa vòng tốc độ / vòng tua không.
- Lớp video không trong suốt: ô vuông đen quanh hình tròn che vạch và số của đồng hồ nằm dưới nó.
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
