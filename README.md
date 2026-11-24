# Camera xi nhan 0.7.11 (BMW iDrive 7 / MGU)

Bật xi nhan bên nào, đồng hồ (instrument cluster) hiện camera gương bên đó, kiểu Hyundai/Kia. Tắt xi nhan thì hình giữ thêm 2 giây rồi tự ẩn. Bật đèn khẩn cấp (hazard) thì không hiện.

Viết cho BMW G30 LCI 2021, iDrive 7, có camera 360 và đã cài MGU Store. Hình lấy từ chính luồng 4 camera mà Drive Recorder Next đang dùng, nên hai app chạy song song được.

> **Trên xe (G30, đến bản 0.3.3):** xi nhan thật bật đúng camera từng bên, hình tròn hiện trong vòng đồng hồ. Luồng của G30 là 1280x480, 30 hình/giây: hai loại khung xen kẽ, mỗi khung 2 camera, phân biệt bằng thẻ SEI (`sei@19`). **Chưa xác nhận trên xe (mới ở 0.4.0):** hướng nhìn "chếch về sau" có đúng là phía sau không, màn hình mới (chạm, trang Vị trí), camera trước giữa đồng hồ.

## MGU Studio 0.11.0 (app thứ hai trong nguồn này; tên cũ: Ảnh đại diện, Dấu Ấn, ID Studio)

**Mới trong 0.11.0:** (1) **Làm nét hình thu nhỏ và video mô phỏng:** trên màn hình xe, hình thu nhỏ trên ba ô chính tăng độ phân giải lên 9 lần (144x72 cho xe, 144x54 cho màn hình khởi động, 52x52 cho ảnh đại diện, 262.144 màu thay vì 4.096 màu rỗ 3x3) và được lưu đệm một lần thành lớp GPU (`G.layer`); màn hình xem thử khởi động tăng từ 120x45 lên **480x180** (nét gấp 16 lần, giữ nguyên lưới đóng/mở 120x45 khối macroblock của H.264 ở tốc độ 30 fps); trên điện thoại có nút xem thử chuyển động trực tiếp ở độ phân giải gốc 1920x720 và ảnh thu nhỏ nét hơn (cao 384px). (2) **Đọc đúng hình gốc từ đầu xe:** ưu tiên đúng mô hình 3D mà `HmiMain3D` đang mở (ví dụ `bmwm/.../F90LCI`, không còn bị gói dự phòng `bmw/.../F40` rộng 672px đè lên hoặc bị `HmiKombi` ghi đè PID), khớp gói trang bị Kombi (`TrimA..E`), chọn đúng màn hình khởi động gốc theo nhật ký `animationplayer` hoặc thương hiệu xe (`0x01` BMW M / `0x00` BMW thay vì bị hàm sắp xếp không ổn định của Node 8 đổi sang bản `0x03` màu đỏ), và tự làm mới hình gốc ngay khi `HmiMain3D` khởi động xong. (3) **Khắc phục màn hình khởi động giữ hình lâu hơn nguyên bản:** giữ nguyên tốc độ khung hình VUI của file `.h264` gốc, chỉ ghi mô hình 3D đang dùng thay vì ghi lại cả 35 dòng xe và xóa toàn bộ bộ đệm shader, đồng thời thêm tuỳ chọn mặc định **Tự tắt về nền đen sau khi hiện xong** (`eva_hi_*_noloop` tự khép về đen sau khi mở/toả sáng và `eva_hi_*_loop` là nền đen) để khi khởi động lạnh đầu xe không giữ treo tấm ảnh sáng suốt ~20 giây chờ `HmiMain3D` lên. **Mới trong 0.10.0:** màn hình xe có chức năng **xem thử màn hình khởi động**: chạm ô *Màn hình khởi động* (hoặc *Xem thử*) để xem hình mở ra lúc lên xe, giữ hình, khép lại lúc tắt xe, đúng thứ tự khối ảnh và cùng chỗ toả sáng như phim sẽ ghi vào xe (mỗi ô vuông của bản xem thử là một khối ảnh của phim; bản xem thử độ phân giải 120x45). Trên trang điện thoại, ảnh khởi động mặc định được gửi lên như **bản nháp** (không đụng file của xe): xem thử trên màn hình xe rồi bấm *Áp dụng cho xe* (hoặc *Bỏ bản nháp*); bỏ dấu chọn thì áp dụng ngay như trước. Hình xe và ảnh đại diện không có xem thử. **Mới trong 0.9.0:** màn hình khởi động có thể làm một điểm (ví dụ logo) sáng lên và toả ánh sáng ra xung quanh sau khi hình mở xong, rồi tắt dần. Trên trang điện thoại, khi chọn ảnh cho màn hình khởi động, bấm *Toả sáng một điểm*, chạm vào chỗ cần sáng và chỉnh khung; trong phim chỉ các khối ảnh quanh điểm đó được gửi lại, nên chất lượng và độ dài phim giữ nguyên. **Mới trong 0.7.0:** tên mới; màn hình trên xe viết lại: ba ô chính (Hình chiếc xe, Màn hình khởi động, Ảnh đại diện) cho biết đang dùng ảnh của bạn hay hình gốc, các hình nhỏ gom vào một dòng *Khác*, bỏ 15 ô ảnh nhỏ và nút *Địa chỉ khác*; thêm nút **Khởi động lại** (trên màn hình xe và trên trang điện thoại) để khởi động lại đầu xe sau khi đổi hình. **0.8.0:** hình chiếc xe chọn được chỗ đổi: cả hai, chỉ ô xe ở màn hình chính (ảnh 2D; mô hình 3D trong menu giữ nguyên chuyển cảnh), hoặc chỉ menu Xe của tôi. Màn hình trên xe: bỏ nút Mã PIN mới; nút Khởi động lại và Khôi phục tất cả bấm lần đầu thì đổi thành *Bấm lần nữa* (tô đỏ) kèm dòng nhắc, bấm lần hai thì báo ngay *Đã nhận lệnh*; ảnh đại diện luôn hiện ba hình; hình gốc của xe lấy từ đúng mô hình màn hình đang mở. Trang điện thoại: dòng nhắc khởi động lại có nút bấm ngay. Xác nhận trên xe M5 CS (F90LCI): ảnh hiện đúng ở ô màn hình chính và trong menu Trạng thái xe (bản 0.7.5). **0.7.5:** tìm mô hình xe ở cả thư mục của BMW M (`bmwm/widgetasset/vehicles`, ví dụ M5 là `F90LCI`) chứ không chỉ `bmw/widgetasset/vehicles`; gói chẩn đoán của một xe M5 CS cho thấy màn hình giữa vẽ xe từ đó. Chưa có file của mô hình F90LCI để thử trên máy. **0.7.4:** mỗi shader bị sửa nhận một mã mới (nửa thấp của mã cũ được thay), vì đầu xe giữ shader đã biên dịch theo mã này và trên xe thật nó ghi lại các bản cũ khi tắt, nên xóa file đệm là không đủ. **0.7.3 (hình chiếc xe trên mọi dòng xe):** chỗ đặt và cỡ tấm ảnh lấy từ chính lưới của từng mô hình (hai tam giác của thân xe làm dấu nhận, bề dài thân xe, mặt sàn), nên không còn riêng cho G20; nhận cả kiểu đặt tên ảnh 2D `trimA` / `trimA_mask`; mô hình nào bị bản 0.5.0 sửa mà bản này không dùng thì được trả về gốc. Kiểm tra bằng file thật của một xe G30 (thư mục F40, G30, G30LCI) trên máy; chưa thử trên xe. **0.7.2:** nút Khởi động lại gọi `nsm_control`; trang điện thoại tải được gói chẩn đoán. **0.7.1:** ba ô chính có hình thu nhỏ của thứ đang dùng. Bộ vẽ của Store không nhận ảnh điểm (vì vậy 15 ô ảnh của các bản trước lên xe bị trống), nên hình thu nhỏ được vẽ bằng các ô vuông màu 3x3 điểm.

Xe không có Connected Drive thì không đổi được ảnh đại diện của profile, và danh sách hình có sẵn chỉ có 15 hình. App này cho đặt ảnh của chính mình lên xe, gửi từ điện thoại:

- **Hình chiếc xe (0.6.0):** một ô ảnh đổi cả hai chỗ. (1) Mô hình 3D trong các menu Xe của tôi (`widgetasset/vehicles/<dòng xe>/vehicle`): shader là văn bản thường trong `effects.res`, nên app ẩn mọi vật liệu của xe và biến lớp sơn thân xe (`M_CAR_MCP1_CARPAINT1`) thành một tấm ảnh đứng đúng chỗ chiếc xe, luôn quay về phía camera, to nhỏ theo khoảng cách camera. Chỉ mảnh thân xe chính vẽ ảnh (shader nhận ra nó qua tọa độ tám đỉnh đầu), lượt vẽ bóng phản chiếu dưới sàn bị bỏ. Ảnh của bạn được gói vào ảnh phủ một kênh của lớp sơn (`TEX_MCP1_CARPAINT1`, 1024x1024): độ sáng ở nửa trên, hai kênh màu và độ trong suốt ở nửa dưới (`car3d.js`, `res.js`). Đầu xe giữ shader đã biên dịch theo mã của shader ở `/var/opt/target/shader-cache`; app xóa đúng các file của mô hình này để đầu biên dịch lại. (2) Ảnh xe 2D (`vehicle2D_big`, `vehicle2D_small`), thứ ô xe ngoài màn hình chính hiện khi nó không dùng mô hình 3D. Ảnh không xoay theo góc nhìn, không mở cửa. Đã thử bằng cách chép file tay trên đầu G20 bench: ảnh hiện trong menu Xe của tôi, Trạng thái xe, Áp suất lốp và ở ô ngoài màn hình chính. Chưa thử qua app, chưa thử trên xe thật.
- **Màn hình khởi động (mới trong 0.4.0):** hình lúc màn hình khởi động, lúc chào khi lên xe và lúc tạm biệt, do `animationplayer` phát từ `/mnt/dataro/dataro1/ent/animationplayer/mgu<đời>/`: `eva_splash_*.png` (ảnh tĩnh) và `eva_hi_*.h264`, `eva_bye_*.h264` (video H.264). App ghi ảnh của bạn vào mọi biến thể và mọi cỡ của đời đầu xe đang dùng: PNG cho ảnh tĩnh, còn video là một đoạn đứng hình cùng cỡ, cùng số khung hình với bản gốc (khung đầu là macroblock không nén I_PCM, các khung sau là "không đổi"; xem `boot.js`). Hiệu ứng chữ BMW chạy không còn. Các file giống nhau được nối cứng (hard link) nên tốn ít chỗ. Từ 0.6.1 đoạn chào và đoạn tạm biệt có chuyển động: hình mở ra từ nền đen (hai vệt chạy từ giữa ra hai bên, rồi mở lên xuống), lúc tạm biệt thì khép lại. Vẫn không cần bộ mã hóa: mỗi ô 16x16 của hình được gửi đúng một lần, không nén, khi tới lượt (`openingVideo` trong `boot.js`). Không làm được hiệu ứng mờ dần như bản gốc. Đã giải mã thử bằng ffmpeg trên máy; chưa thử trên đầu xe.
- **Ảnh đại diện:** 15 hình trong danh sách chọn ảnh của profile. Mỗi hình được ghi vào cả ba gói của xe: hình to 570x570 (chỗ chọn ảnh) và hai bộ biểu tượng nhỏ 84x72, 72x72 (danh sách, thanh trạng thái).
- **Hình mặc định (mới trong 0.2.0):** hình xe hiện khi không có ảnh bìa hay ảnh người gọi: nhạc Bluetooth, nhạc USB, nhạc, radio FM/AM, radio, người gọi không có ảnh. Một ảnh được ghi vào cả 4 cỡ và 2 màu (xanh, đỏ) của gói. Xe không có gói nào, hoặc gói khác cấu trúc, thì mục đó không hiện.

**Dùng:** cài **ID Studio** từ MGU Store (cùng nguồn `marilykinson-glitch/id7-sideview-test`, nhánh `main`; Store cài luôn **Trợ thủ ID Studio**), khởi động lại màn hình một lần. Mở app trên xe: màn hình hiện mã QR và mã PIN. Quét QR bằng điện thoại (điện thoại và xe cùng Wi-Fi hoặc điểm phát sóng), chạm một hình, chọn ảnh, kéo và phóng to để cắt vuông, bấm **Dùng ảnh này**. Khởi động lại màn hình xe để xe dùng hình mới. Số hình là thứ tự trong danh sách chọn ảnh trên xe.

**Khôi phục:** trên trang điện thoại có nút khôi phục từng hình và tất cả; trên xe có nút **Khôi phục tất cả**. Bản gốc của từng gói được sao lưu một lần ở `/var/opt/anh-dai-dien/backup/` trước khi đổi gì (với gói ảnh đại diện, nếu đã có bản `/var/opt/avatar_backup/wbitmaps.res.orig` tự sao lưu thì lấy bản đó làm bản gốc).

**Cách hoạt động:** các hình nằm trong những gói `wbitmaps.res` (định dạng tài nguyên Ramses, mỗi hình RGBA nén LZ4) dưới `assetDB` trên phân vùng chỉ đọc `/mnt/dataro`. Trợ thủ đọc gói, thay đúng các hình được chọn, kiểm tra gói mới đọc lại được, mở ghi phân vùng trong giây lát, ghi file mới cạnh file cũ rồi đổi tên đè lên (một thao tác), và khóa chỉ đọc lại. Gói có cấu trúc lạ (xe khác, bản phần mềm khác) thì không ghi gì. Trang điện thoại phục vụ qua HTTP trong mạng nội bộ cổng 8137; tường lửa của đầu xe (nftables, `ip filter input`) mặc định chặn cổng lạ, nên trợ thủ giữ một luật cho cổng đó vào trên đúng giao diện mạng của địa chỉ trong mã QR (kiểm tra lại mỗi 30 giây, gỡ khi dừng). Trang cần mã PIN 4 số hiện trên xe (sai 5 lần thì khóa địa chỉ đó 1 phút). Mã nguồn: `tools/anh-dai-dien/` (`wbm.js` đọc/ghi gói, `anh-dai-dien.js` dịch vụ, `page.html` trang điện thoại) và `apps/anh_dai_dien/`.

**Đã kiểm tra gì:** trên máy, với bản sao các gói thật của một đầu G20 trên bench (ảnh đại diện 3 gói, bìa Bluetooth, người gọi, hình xe G20 to và nhỏ, ảnh và video khởi động 1440x540; video làm ra được ffmpeg giải mã đúng ảnh): đọc, ghi lại giống từng byte, đổi hình, khôi phục về đúng file gốc. Trên xe: một gói ảnh đại diện ghi tay vẫn còn nguyên sau khi khởi động lại (xe không tự khôi phục). **Chưa kiểm tra trên xe:** app và trợ thủ chạy thật, bộ giải mã của đầu xe có phát được video đứng hình không (nếu không: khôi phục từ app), điện thoại nối vào cổng 8137 (tường lửa), chiều ảnh khi hiện, hình chiếc xe 3D (shader đã sửa biên dịch được và vẽ đúng trong một trình biên dịch GLSL thật trên máy, nhưng chưa biết đầu xe có dùng bản shader đã biên dịch sẵn không, tấm bóng đổ có được vẽ ở mọi màn hình không), các gói hình mặc định ngoài hai gói kể trên (cùng tên hình và cỡ thì dùng, khác thì bỏ qua).

## Thời tiết 0.7.19 (app thứ ba trong nguồn này; trợ thủ `thoi-tiet` 0.5.0)

Bản 0.7.19 hiển thị luôn nhiệt độ thấp của 3 ngày tới trên widget lớn màn hình chính bằng cách ghép lên dòng tiêu đề cột rộng (`TextDayliDetail1..3`: `Mai · 25°`, `T4 · 24°`, `CN · 25°`) và giữ nhiệt độ cao chữ to ở dưới (`TextTempDayDetail1..3`: `33°`), tránh bị khuôn gốc `LT_Table_OnlineApps_WeatherWidget` của BMW cắt chữ.

Bản 0.7.18 và trợ thủ 0.5.0 đọc trực tiếp tọa độ GPS / định vị bản đồ của xe qua SOME/IP (`Positioning.currentLocation` vẫn có vị trí khi xe đậu dưới hầm, dự phòng `rawPositionData` và `GnssPositioning`), tra ngược tên tỉnh/thành tiếng Việt có dấu, tự cập nhật khi xe di chuyển và xoá bộ nhớ đệm vị trí mạng mỗi lần bấm **Làm mới** (khắc phục lỗi mạng di động CGNAT ở TP.HCM bị `ipwho.is` định vị nhầm sang `Long Thanh`).

Trợ thủ 0.4.5 lấy dự báo mỗi 15 phút; khi tải lỗi vẫn thử lại sau 1 phút.

Bản 0.7.17 căn khoảng hở lề phải bằng lề trái (56px), áp dụng cùng mép cho các nút, giờ cập nhật và dự báo.

Bản 0.7.16 sửa nền nâu vuông của mặt trời trên widget, thu gọn lề phải, xoá ô widget khi mất dữ liệu và khi thiếu ngày dự báo. Trợ thủ 0.4.4 giữ lệnh đổi địa điểm trong lúc tải, tính mưa đúng khi qua nửa đêm, đánh dấu dữ liệu cũ và thử lại sau một phút khi tải lỗi. Đồng bộ xoá địa điểm từ điện thoại, xử lý kết nối bị ngắt và dữ liệu thiếu; AQI không lấy được hiện chưa có thay vì giữ chỉ số cũ. Bộ kiểm tra có các ca hồi quy tương ứng và kiểm tra cú pháp ES2017/Node 8. Bản sửa đã kiểm tra trên máy; cần xác nhận hình và lề trên xe thật trước khi coi là đã nghiệm thu trên xe.

Trợ thủ ra mạng qua uplink của Store (`mgu-uplink`) bằng uid riêng + DNS trong `/run/mgu-uplink/lease.json`, giống RideTube (root không được uplink cho ra mạng).


Dự báo thời tiết trên màn hình xe, theo kiểu ứng dụng Thời tiết của BMW Connected Drive (xe không cần Connected Drive) nhưng nhiều hơn:

- Nhiệt độ, biểu tượng, gió (có mũi tên hướng), độ ẩm, khả năng mưa, UV, chất lượng không khí (AQI), tầm nhìn, áp suất, gió giật, giờ mặt trời mọc/lặn: **nút Cài đặt** để bật tắt từng ô (tối đa 8), đổi °C/°F.
- Khối giữa bên phải chọn được: theo giờ (biểu tượng), biểu đồ nhiệt độ 24 giờ, cung mặt trời, hoặc ẩn; 5 ngày tới bật tắt được.
- Hiệu ứng chuyển động theo thời tiết (nắng, mây, mưa, giông có chớp, tuyết, sương, gió, sao đêm), tắt được trong Cài đặt.
- Lời nhắc cho người lái ("Mưa lúc 16:00", "Đường trơn", "Sương mù: bật đèn sương", "Bụi mịn cao"…).
- Chế độ **Lái xe**: chữ rất to, chỉ giữ những gì cần liếc nhìn.
- Địa điểm: tối đa 6; vị trí hiện tại (đọc trực tiếp GPS / định vị bản đồ của xe, dự phòng theo địa chỉ mạng khi xe chưa có tọa độ), 46 thành phố trong nước lọc theo vùng, 18 thành phố nước ngoài, và **tìm bằng điện thoại**: quét mã QR, gõ tên bất kỳ nơi nào trên thế giới (trang web do trợ thủ mở ở cổng 8138, có mã PIN như MGU Studio), bấm Thêm là hiện ngay trên xe.

Dữ liệu từ Open-Meteo (không cần khoá), 15 phút lấy một lần. Xe tự lấy dự báo qua Wi-Fi của chính nó (trang điện thoại chỉ để tìm và thêm địa điểm, không gửi dự báo). Cần xe có mạng. Open-Meteo miễn phí chỉ dành cho dùng phi thương mại: lắp cho khách nên cân nhắc.

## Mới trong 0.7.11 (trợ thủ 0.7.9)

- **Vòng xuyến có mũi tên trên camera.** Trước đây vòng xuyến chỉ có ô trên cùng, trên hình không vẽ gì. Giờ vẽ mũi tên chếch về phía xe đi vào vòng (đi bên phải: chếch phải), ô trên cùng vẫn có hình vòng và số lối ra.

## Mới trong 0.7.10 (trợ thủ 0.7.8)

- **Kiểu "Trên mặt đường": chếch không còn trông như rẽ.** Hàng mũi tên đứng ở chỗ rẽ trước đây chỉ ngang cả với chếch 30°. Giờ chếch vẽ ba mũi tên chỉ chéo lên (↗ / ↖) đặt cạnh nhau, không đè lên ô khoảng cách và tên đường; rẽ vẫn là hàng mũi tên chỉ ngang.

## Mới trong 0.7.9 (trợ thủ 0.7.7)

- **Sửa: "chếch phải/chếch trái" bị vẽ như rẽ.** Dải chevron kiểu BMW chỉ biết trái/phải nên chếch và rẽ trông y như nhau. Giờ chếch (dưới 60°) vẽ chevron chỉ chéo lên phía trước, rẽ vẫn chỉ ngang. Chỗ đường tách nhánh ("đi theo làn phải", ngã ba chữ Y, lối ra) luôn tính là chếch, không bao giờ là rẽ vuông góc.

## Mới trong 0.7.8 (trợ thủ 0.7.6)

- **Sửa: tệp điều khiển có thể vẫn ghi vào flash.** Trợ thủ giao thư mục RAM cho chủ thư mục data của app, có thể không phải người dùng mà app thật sự chạy (lỗi này lộ ra ở app Biển báo VietMap). App khi đó lặng lẽ ghi vào flash mỗi nửa giây. Giờ thư mục được giao cho đúng người dùng của tiến trình app.
- **Sửa: kéo thả bị kẹt** nếu không nhận được lúc nhấc tay hoặc chuyển tab giữa chừng. Lần chạm sau, hoặc 10 giây không động tới, sẽ huỷ lần kéo đó (không lưu).

## Mới trong 0.7.7 (trợ thủ 0.7.5)

- **Sửa: hình camera có thể đứng mà không tự ẩn.** Khi một trong hai nhóm khung (trước|sau hoặc trái|phải) ngừng đến, không tạo được ảnh ghép mới, nhưng nhóm còn lại vẫn làm "mới" lần kiểm tra, nên ảnh cũ cứ hiện như hình trực tiếp. Giờ kiểm tra tuổi của chính ảnh ghép đang hiện: quá 0,8 giây là ẩn, màn hình app ghi rõ "một trong hai nhóm hình camera ngừng đến".

## Mới trong 0.7.6 (trợ thủ 0.7.4)

- **Sửa: mất một khung hình có thể tráo camera** trong khoảng 5 khung sau đó (hình bên trái lọt vào ô bên phải và ngược lại). Bộ ghép giờ nhớ byte SEI và hai giá trị đã học, nên mỗi khung được nhận theo chính giá trị của nó, mất bao nhiêu khung cũng không lệch.

## Mới trong 0.7.5

- **Kéo thả ở tab Vị trí**: đặt ngón tay lên vòng camera trong hình đồng hồ rồi kéo, camera trên đồng hồ xe chạy theo ngay. Thả tay mới lưu (lưu một lần, không ghi liên tục). Chạm một cái vẫn đặt camera vào chỗ chạm như trước.

## Mới trong 0.7.4

- **Sửa: app không tự chạy khi khởi động đầu xe**, phải mở app một lần mới có camera theo xi nhan. Cấu hình có ghi tự chạy nhưng bộ build không đưa vào gói cài, nên Store đăng ký app ở dạng mở bằng tay. Giờ gói cài ghi `mguAppStartType: autostart`: cập nhật xong, từ lần khởi động sau app tự chạy ngầm.

## Mới trong 0.7.2

- **Sửa: camera trước không bao giờ tắt** sau lần rẽ đầu tiên của một lộ trình (khoảng giữ 3 giây tự gia hạn mãi). Giờ qua chỗ rẽ 3 giây là trả lại Google Maps.
- **Sửa: ô mũi tên và tên đường nằm ở góc trái** khi chọn *Kiểu mũi tên: Trên mặt đường*, bị góc vát của đồng hồ che. Giờ luôn nằm giữa mép trên.
- Trên xe (G30): mũi tên, tên đường, hai camera cùng lúc khi đang chạy.
- 0.7.3: chevron trên mặt đường (*Kiểu mũi tên: Trên mặt đường*) chạy chậm bằng một nửa.

## Mới trong 0.7.1

- **Camera trước nét lại.** Mức mới *Rộng nét (640)* (mặc định): lấy đúng 640x288 điểm ảnh của camera, không phóng to. *Rộng kiểu BMW (960)* vẫn còn nhưng là phóng 1,5 lần nên mờ hơn.
- **Camera trước mặc định Tắt** (đổi một lần khi cập nhật). Mũi tên dẫn đường vẫn tự bật camera trước khi gần chỗ rẽ.
- **Mũi tên dẫn đường chỉ bật khi có rẽ thật** (rẽ, chếch, quay đầu, vòng xuyến, sắp tới nơi), không bật cho "đi thẳng".
- **Bật khoảng 12 giây trước chỗ rẽ** tính theo tốc độ xe (từ 80 m đến 400 m; chưa biết tốc độ thì 250 m), giữ tới khi qua chỗ rẽ thêm 3 giây, không chớp tắt khi khoảng cách nhảy.
- **Dòng *Hiệu năng*** ở tab Camera: thời gian giải mã, thời gian vẽ từng hình, số hình gửi mỗi giây, gói hình bị rớt, nhiệt độ CPU (nếu đọc được).

## Mới trong 0.7.0

- **Không ghi liên tục lên bộ nhớ flash nữa.** File điều khiển (ghi 2 lần mỗi giây khi có hình), hình tên đường và nhật ký dẫn đường giờ nằm trong RAM (`/run/xinhan-cam`), mất khi tắt máy. Cài đặt vẫn lưu như cũ. Cần khởi động lại màn hình một lần để trợ thủ lên 0.7.0; trước đó app vẫn ghi vào chỗ cũ như các bản trước.
- **Sửa: mục *Giới hạn tốc độ* làm mất luôn camera trước và mũi tên dẫn đường** khi xe chạy nhanh hơn mức đặt. Mục này chỉ dành cho camera gương: chạy nhanh hơn thì bật xi nhan coi như không bật, camera trước vẫn ở lại.
- Trên xe (G30): camera trước và camera gương hiện cùng lúc khi xi nhan, cả khi có Google Maps trên đồng hồ.

## Mới trong 0.6.5

- **Trên xe (G30):** tên đường dưới ô rẽ hiện đúng, có dấu.
- **Hai camera khi đang chọn *Cách lấy hình: Riêng cam gương*.** Chế độ đó bắt hộp camera chỉ phát một camera gương lúc xi nhan, nên không còn hình camera trước để giữ (đó là lý do khúc giữa trống trên xe). Giờ khi cần giữ camera trước, app tạm dùng hình 4 camera cho lần xi nhan đó; lúc camera trước không hiện thì chế độ riêng vẫn như cũ.

## Mới trong 0.6.4

- *Khi xi nhan* mặc định là **Giữ cam trước**: hễ camera trước đang hiện (do dẫn đường hay do mục *Camera trước*) thì bật xi nhan nó vẫn ở lại.
- Mục mới *Cam trước lúc xi nhan*: **Ở vùng bản đồ** (mặc định) hoặc **Chung vùng cam gương** (dùng chung một bộ đệm video, thử khi có bản đồ điện thoại trên đồng hồ).
- Dòng *Hai camera* ở tab Camera ghi rõ trạng thái từng hình lúc xi nhan.

## Mới trong 0.6.3

- **Tên đường dưới ô rẽ.** Android Auto gửi tên đường sắp rẽ vào (thấy trong nhật ký xe, ví dụ "Tân Phú / Đ. Số 23"); app vẽ chữ có dấu rồi trợ thủ ghép lên hình camera trước. Tắt ở mục *Tên đường*. Chưa thử trên xe.
- Android Auto không gửi hình dạng ngã rẽ (trường đó trống), nên dải chevron vẫn đặt theo khoảng cách.
- Nhật ký không còn ghi lặp mỗi giây cùng một lệnh rẽ.

## Mới trong 0.6.1

- **Trên xe (G30, Android Auto + Google Maps):** lệnh rẽ của điện thoại đọc được (dạng yêu cầu `keyed false`), dải chevron và ô khoảng cách hiện trên camera trước.
- **Hai camera cùng lúc khi đang có bản đồ điện thoại trên đồng hồ.** Bản đồ đó là hình video thứ ba nên 0.6.0 phải lùi về chỉ camera gương. Giờ trong lúc xi nhan, camera trước chuyển sang cùng vùng vẽ "toàn đồng hồ" với camera gương: hai hình cùng một vùng dùng chung một bộ đệm video. Chưa thử trên xe: camera trước có nằm đúng chỗ cũ và có nằm trên bản đồ điện thoại không; nếu không thì kết quả như 0.6.0 (chỉ camera gương).

## Mới trong 0.6.0

- **Camera trước ở lại khi bật xi nhan.** Mục *Khi xi nhan*:
  - *Giữ cam trước khi có mũi tên* (mặc định): đang có mũi tên dẫn đường mà bật xi nhan thì camera trước vẫn ở giữa, camera gương hiện thêm trong vòng đồng hồ bên đó. Không dẫn đường thì như cũ.
  - *Luôn giữ cam trước*: cả khi camera trước đang hiện vì mục *Camera trước*.
  - *Chỉ cam gương*: như các bản trước, camera gương thay chỗ camera trước.
- **Nhường nhau.** Đồng hồ và HUD cùng lúc chỉ chứa được 2 hình video. Nếu bộ vẽ từ chối hình thứ hai (ví dụ đang có bản đồ điện thoại trên HUD), app tự chuyển về chỉ camera gương trong 15 giây rồi mới thử lại: camera gương luôn được ưu tiên hơn camera trước.
- Chưa thử trên xe: hai hình cùng lúc có làm giật không.

## Mới trong 0.5.4

- **Lệnh rẽ của điện thoại (CarPlay, Android Auto).** Khi điện thoại dẫn đường, dịch vụ dẫn đường của xe vẫn báo INACTIVE; lệnh rẽ của điện thoại nằm ở một giao diện khác (`...GuidanceEventList`), phải hỏi mỗi giây bằng lệnh `queryContent` (chỉ hỏi, không đổi gì trên xe). Bản trước chưa hỏi nên không có mũi tên. Chưa thử trên xe: cách viết yêu cầu cho đầu xe được thử lần lượt 4 kiểu, kết quả từng kiểu ghi trong nhật ký.
- Dải chevron không còn viền trắng.
- Trên xe (G30) đã thấy: nút *Xem thử* hiện camera trước giữa đồng hồ với dải chevron và ô khoảng cách.

## Lấy nhật ký dẫn đường bằng điện thoại (không cần SSH)

1. Chạy dẫn đường qua vài chỗ rẽ (mục *Mũi tên dẫn đường* đang bật).
2. Trong MGU Store cài công cụ **Nhật ký Camera xi nhan** (`xinhan-cam-log`). Lúc cài nó in nhật ký vào log của Store.
3. Store → Settings → Phone access → On, quét mã QR bằng điện thoại, mở **Logs: updater**. Các dòng bắt đầu bằng `XNC` là nhật ký; chép hết từ `XNC ==` đầu đến `XNC == het`.
4. Muốn in lại: gỡ công cụ rồi cài lại. Xong thì gỡ.

## Mới trong 0.5.2 (theo clip Augmented View của xe nguyên bản)

- **Mũi tên kiểu BMW** (mặc định): một dải chevron trắng trên nền đen, nằm phẳng trên hình tại chỗ rẽ và chỉ vào hướng rẽ; còn xa thì nhỏ, tới gần thì lớn dần, chevron chạy dọc dải. Kiểu cũ (chevron trên mặt đường + mũi tên đứng) còn ở mục *Kiểu mũi tên: Trên mặt đường*.
- **Camera trước rộng kiểu BMW** (mặc định mới của *Cỡ cam trước*): 960x432, gần kín vùng giữa hai đồng hồ, hai mép trái phải mờ dần vào nền đen. Lấy một dải ngang của hình camera; *Dịch hình xuống* trong tab Canh chỉnh để đưa đường chân trời về giữa.
- Ô mũi tên + khoảng cách chuyển lên giữa mép trên.

## Mới trong 0.5.0

Chưa phần nào của 0.5.0 được thử trên xe.

- **Tab Canh chỉnh.** Chọn *Gương trái*, *Gương phải* hoặc *Camera trước*; camera đó hiện trên đồng hồ suốt lúc mở tab.
  - Camera gương: dịch phần hình được lấy (lên, xuống, trái, phải) và phóng to riêng từng bên.
  - Camera trước: độ cao, chúc xuống, góc nhìn, lệch trái/phải, dịch ngang, độ cong mắt cá, phóng to. Trên hình có hai vạch vàng (mép làn rộng 3 m) và vạch ngang ở 5, 10, 20 m: chỉnh đến khi chúng nằm đúng trên mặt đường. Mũi tên dẫn đường dùng chính các số này.
- **Tab Dẫn đường: mũi tên trên camera trước.** Khi sắp tới chỗ rẽ (mặc định còn 250 m) camera trước hiện giữa đồng hồ, vệt chevron chạy trên mặt đường rồi bẻ vào hướng rẽ, bốn mũi tên trắng lớn đứng ở chỗ rẽ và sáng lần lượt (0.5.1; đổi sang xanh ở mục *Màu mũi tên*), góc trên có thẻ mũi tên và khoảng cách. Chọn *Khi sắp rẽ*, *Suốt đường* hoặc *Tắt*. Nút *Xem thử 25 giây* vẽ một chỗ rẽ giả để xem hình dáng mà không cần dẫn đường.
  - Lệnh rẽ được trợ thủ đọc từ dịch vụ dẫn đường của chính đầu xe (giao diện `...Guidance`, trường `conclusiveDart`), chỉ đọc. Bản đồ BMW chắc chắn đưa dữ liệu vào đó. CarPlay và Android Auto thì tùy đầu xe có nhận lệnh rẽ của điện thoại hay không; trên iDrive 7 chưa ai xác nhận. Waze không gửi lệnh rẽ cho xe nên sẽ không có mũi tên.
  - Tab này hiện đang đọc được gì (dòng *Đọc dẫn đường*, *Nguồn*, *Lệnh kế tiếp*, *Dữ liệu thô*). Nhật ký đầy đủ: `/run/xinhan-cam/nav.log` trên đầu xe (trong RAM, mất khi tắt máy).
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
| Mũi tên dẫn đường | Khi sắp rẽ | Khoảng 12 giây trước chỗ rẽ thật. Suốt đường, Tắt. Xem tab Dẫn đường |
| Khi xi nhan | Giữ cam trước khi có mũi tên | Luôn giữ cam trước, Chỉ cam gương |
| Thẻ rẽ | Hiện | Thẻ mũi tên + khoảng cách ở góc hình camera trước |
| Cỡ cam trước | Rộng nét (640x288) | Rộng kiểu BMW 960x432 (phóng to, mờ hơn), Nhỏ 384x288, Vừa 512x384, Lớn 640x480 |
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
