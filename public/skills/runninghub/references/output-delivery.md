# Output & Delivery

## Progress Notification (for slow tasks)

For video, AI app, 3D, and music generation: **ALWAYS send a `message` notification BEFORE starting the script.** These tasks take 1-10+ minutes. Users must know the task has started.

```json
{ "action": "send", "text": "开始生成啦，视频一般需要几分钟，请稍等～ 🎬", "target": "<user>" }
```

Do this BEFORE calling `exec` to run the script. For fast tasks (text-to-image, image upscale, TTS), notification is optional.

## Media (image/video/audio/3D)

Script prints `OUTPUT_FILE:/path` and optionally `COST:¥X.XX`.

**You MUST use the `message` tool to deliver files. Printing file paths as text does NOT work — users on Feishu/Lark/Slack cannot access local paths.**

Step 1 — ALWAYS call `message` tool:
```json
{ "action": "send", "text": "搞定啦！花了 ¥0.12～ 要不要做成视频？🐱", "media": "/tmp/openclaw/rh-output/cat.jpg" }
```
Step 2 — Then respond with `NO_REPLY` (prevents duplicate message).

**If `message` tool call fails** (error/exception):
- Retry the `message` tool call once.
- If still fails → include `OUTPUT_FILE:<path>` in text AND tell user: "文件生成好了但发送遇到问题，我再试一次～"

**NEVER do these**:
- Print `OUTPUT_FILE:` as first-choice delivery (users see raw text, not a file!)
- Show `runninghub.cn` URLs (internal, users cannot open)
- Use `![](...)` markdown images
- Say "已发送" or "点击下面的附件" without actually calling `message` tool

## Text Results

Print the text directly to user. Include cost if `COST:` line present.

## Errors & Retry

| Error | Action |
|-------|--------|
| `NO_API_KEY` | Guide Gateway account setup → Read `{baseDir}/references/api-key-setup.md` |
| `AUTH_FAILED` | Ask the user to sign in again or contact support; desktop does not manage upstream credentials |
| `INSUFFICIENT_BALANCE` | "韭菜花余额不足，请在账号中心充值或开通会员后继续。" |
| `TASK_FAILED` | For video: offer fallback model. For others: show friendly error, offer retry. |

## General Notes

- Video is slow (1-5 min); script auto-polls up to 15 min.
- Images < 5MB → base64; larger → upload first.
- Desktop media access is driven by 韭菜盒子账号会员、Gateway and NewAPI automatic routing, not user-supplied upstream credentials.
