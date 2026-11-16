# ID7 Side View Test 0.1.0

Bản chẩn đoán cho BMW G30 LCI 2021 chạy iDrive 7 và MGU Store. App mở thủ công, hiển thị trạng thái xi nhan mà MGU nhận được và tên một số interface liên quan đến camera nếu đọc được danh mục OAP cục bộ. Bản này chưa mở camera. App không gọi lệnh điều khiển xe, không yêu cầu mạng, và không tự chạy cùng đầu xe.

## Cài từ USB

1. Giải nén ZIP. Chép nguyên thư mục `id7-sideview-test` vào thư mục `mgu-repo` ở gốc USB. Đường dẫn manifest là `mgu-repo/id7-sideview-test/mgu-repo.json`.
2. Cắm USB vào xe đang đỗ. Vào **MGU Store → USB → ID7 Side View Test → Install**. Store build từ source bằng SDK sẵn trên đầu xe.
3. Mở **ID7 Side View Test** từ danh sách app. Bật trái, bật phải, bật hazard, rồi tắt. Giữ mỗi trạng thái vài giây. Chụp màn hình sau chuỗi thử hoặc gửi video ngắn nếu dòng Turn signal thay đổi bất thường. Nếu cài lỗi, chụp nguyên thông báo lỗi của Store.

## Cài qua GitHub

Đưa nội dung thư mục này lên nhánh `main` của repo GitHub, với `mgu-repo.json` ở gốc. Vào **MGU Store → Settings → Add source**, chọn repo và nhánh `main`, rồi cài app.

## Mã nguồn

Kit MIT lấy từ [eroobeeroo/idrive7-cluster-info](https://github.com/eroobeeroo/idrive7-cluster-info/tree/10cefda018e59a4b21b4aa8026fc9116f0f4bd9e/kit). Các tên sự kiện và giá trị xi nhan tham chiếu Cluster Info cùng repo. ZIP chứa source, không chứa BMW OAP SDK.

[Hướng dẫn MGU Store](https://github.com/robertnisipeanu/mgu-store/blob/main/docs/PUBLISHING.md)
