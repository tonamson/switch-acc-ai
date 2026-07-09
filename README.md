# Codex Account Switcher

`cx` chạy Codex CLI với từng account riêng bằng `CODEX_HOME`.

Mỗi account được lưu ở:

```bash
~/.codex-accounts/<name>
```

Codex OAuth vẫn do `codex login` xử lý. Script này chỉ đổi thư mục lưu profile.

## Cài đặt

```bash
chmod +x ./cx
```

Muốn gọi ở mọi nơi:

```bash
ln -s "$(pwd)/cx" /usr/local/bin/cx
```

## Đăng nhập account

```bash
./cx login main
./cx login acc2
```

Mỗi lệnh sẽ mở OAuth login riêng. Login xong, token của account đó nằm trong profile riêng.

## Chạy Codex bằng account cụ thể

```bash
./cx main
./cx acc2
```

Truyền thêm tham số cho `codex` cũng được:

```bash
./cx acc2 --help
```

## Đặt account mặc định

```bash
./cx use acc2
./cx run
```

Kiểm tra account mặc định:

```bash
./cx current
```

## Xem danh sách account

```bash
./cx list
```

## Đổi tên account

```bash
./cx rename acc2 backup
```

Nếu `acc2` đang là mặc định, mặc định sẽ tự đổi sang `backup`.

## Xóa account

```bash
./cx remove backup
```

Lệnh này xóa thư mục profile:

```bash
~/.codex-accounts/backup
```

## Đổi nơi lưu profile

Mặc định dùng `~/.codex-accounts`. Muốn đổi:

```bash
CODEX_ACCOUNTS_DIR=~/my-codex-accounts ./cx list
```
