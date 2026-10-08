# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository. Include steps to reproduce and the
version (commit) you tested. You should get a reply within a week.

## Keeping your own deployment safe

- Never commit `.env`, API keys, or the `data/` folder. They are listed in `.gitignore`; keep it that way.
- Use a long `GROUP_PASSWORD` (the server refuses anything under 12 characters) and run behind HTTPS.
- If an Anthropic API key is ever exposed, revoke it at console.anthropic.com immediately and create a new one.
- Back up `data/mdshare.sqlite` regularly; there is no version history yet.

See the **Security** section of the README for what MdShare protects against today and its known limits.
