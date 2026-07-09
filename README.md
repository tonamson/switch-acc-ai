# Codex Account Switcher

`cx` chạy Codex CLI với từng account riêng bằng `CODEX_HOME`.

Mỗi account được lưu ở:

```bash
~/.codex-accounts/<name>
```

Codex OAuth vẫn do `codex login` xử lý. Script này chỉ đổi thư mục lưu profile.
`skills`, `plugins`, `sessions` và `config.toml` được symlink từ `~/.codex` vào từng profile để MCP/skills/plugin và resume session dùng chung.

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

Muốn mở menu điều hướng bằng phím mũi tên:

```bash
./cx
```

Menu đầu tiên cho chọn CLI:

```text
Codex
Claude
Exit
```

Chọn `Codex` rồi dùng `Enter` để vào các chức năng như chạy Codex bằng account, login account, chọn account mặc định, xem status/limit, đổi tên hoặc xóa account.

Hoặc truyền tham số Codex sau khi chọn `Codex -> Run with account`:

```bash
./cx pick --model gpt-5.5
```

Các option Codex cũng có thể đặt ngay sau `cx`; script sẽ mở menu rồi forward option sang `codex` sau khi chọn account:

```bash
./cx --model gpt-5.5
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

Danh sách sẽ hiển thị tên profile kèm email/username mà Codex trả về.

## Xem limit/status

Xem account mặc định:

```bash
./cx status
```

Xem account cụ thể:

```bash
./cx status acc2
```

Xem tất cả account:

```bash
./cx status --all
```

Lệnh này hiển thị email/username, 5h limit, weekly limit, thời điểm reset, plan và reset credits.

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

Muốn đổi nơi lấy skills/plugins/config dùng chung:

```bash
CODEX_SHARED_HOME=~/my-codex-home ./cx acc2
```
