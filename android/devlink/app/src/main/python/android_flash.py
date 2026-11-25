"""
Cầu nối chạy flash/enroll (mở root SSH qua ENET) của bộ idrive7-8-ssh-root
NGAY TRONG app Android qua Chaquopy. Dùng lại gần như nguyên xi ssh_enable.py +
mgu7 đã chạy ổn trên Windows.

Trên Android KHÔNG có lệnh `ssh`, nên:
  - Phần flash + enroll (ENET/UDS) chạy bình thường (không cần ssh).
  - verify_ssh / persist (vốn gọi ssh binary) sẽ tự xuống thang: cảnh báo rồi bỏ
    qua. Sau khi enroll mở được port 22, phía Java (sshj) tự lo verify/persist.

Java gọi:
    android_flash.run_flash(action, vin, arch, gateway, mgu_ip, assets_dir, work_dir, cb)
  cb: đối tượng Java có phương thức line(str) để nhận log trực tiếp.
"""

import os
import sys


class _Sink:
    """Chuyển mọi thứ in ra (stdout/stderr + log) về callback Java."""
    def __init__(self, cb):
        self._cb = cb
        self._buf = ""

    def write(self, s):
        if not s:
            return 0
        try:
            self._cb.line(s)
        except Exception:
            pass
        return len(s)

    def flush(self):
        pass

    def isatty(self):
        return False


def _patch_paths(assets_dir, work_dir):
    """Trỏ thư mục assets (PEM/bin) và nơi ghi key sang đường dẫn ghi được của Android."""
    from mgu7 import assets as A
    A.ASSET_DIR = assets_dir
    try:
        A.Assets.__init__.__defaults__ = (assets_dir,)  # đổi tham số mặc định directory=
    except Exception:
        pass

    from mgu7 import identity as I
    enroll_dir = os.path.join(work_dir, "enrollments")
    I.ENROLL_DIR = enroll_dir
    os.makedirs(enroll_dir, exist_ok=True)
    return enroll_dir


def run_flash(action, vin, arch, gateway, mgu_ip, assets_dir, work_dir, cb):
    """Chạy một hành động (flash/enable/status/...). Trả về (rc, enroll_dir)."""
    old_out, old_err = sys.stdout, sys.stderr
    sink = _Sink(cb)
    sys.stdout = sink
    sys.stderr = sink
    try:
        enroll_dir = _patch_paths(assets_dir, work_dir)
        import ssh_enable  # import sau khi đã patch path

        argv = [action, "--arch", arch, "--no-log"]
        if vin:
            argv += ["--vin", vin]
        if gateway:
            argv += ["--gateway", gateway]
        else:
            argv += ["--gateway", "auto"]
        if mgu_ip:
            argv += ["--mgu-ip", mgu_ip]

        try:
            rc = ssh_enable.main(argv)
        except SystemExit as e:        # connect() dùng SystemExit cho vài lỗi
            code = e.code
            if isinstance(code, int):
                rc = code
            else:
                print(str(code) if code is not None else "Dừng.")
                rc = 1
        except BaseException as e:      # bắt mọi lỗi để báo gọn lên UI
            print("LỖI: %r" % (e,))
            rc = 1
        return (int(rc or 0), enroll_dir)
    finally:
        sys.stdout = old_out
        sys.stderr = old_err


def discover(cb):
    """Dò gateway + VIN qua ENET (UDP 6811). Trả về 'ip|vin' của gateway đầu, hoặc ''."""
    old_out, old_err = sys.stdout, sys.stderr
    sink = _Sink(cb)
    sys.stdout = sink
    sys.stderr = sink
    try:
        from mgu7 import discovery
        gws = discovery.discover(log=lambda *a, **k: print(" ".join(str(x) for x in a)))
        if not gws:
            return ""
        g = gws[0]
        return (getattr(g, "ip", "") or "") + "|" + (getattr(g, "vin", "") or "")
    except BaseException as e:
        print("Dò lỗi: %r" % (e,))
        return ""
    finally:
        sys.stdout = old_out
        sys.stderr = old_err


def read_enrolled_key(enroll_dir, vin):
    """Đọc khóa OpenSSH (id_rsa) vừa enroll ra, để phía Java nối sshj. Trả về chuỗi PEM hoặc ''."""
    try:
        from mgu7 import identity as I
        name = I._slug(vin.upper()) if vin else None
        cand = []
        if name:
            cand.append(os.path.join(enroll_dir, name))
        if os.path.isdir(enroll_dir):
            for n in os.listdir(enroll_dir):
                p = os.path.join(enroll_dir, n)
                if os.path.isdir(p):
                    cand.append(p)
        for d in cand:
            for fn in ("id_rsa", "id_rsa.pkcs1.pem", "id_rsa.pkcs8.pem"):
                p = os.path.join(d, fn)
                if os.path.isfile(p):
                    with open(p, "r", encoding="utf-8", errors="replace") as f:
                        return f.read()
    except Exception:
        pass
    return ""
