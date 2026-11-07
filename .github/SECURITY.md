# Security Policy

## Reporting a vulnerability
Please report privately using GitHub's "Report a vulnerability" (Security Advisories) on this repository. Don't open a public issue for security problems.

Include: affected version, steps to reproduce, impact, and any suggested fix. We aim to acknowledge within 72 hours and to ship a fix or mitigation as quickly as possible.

## Scope
In scope: the desktop app, the MCP server and installer, file handling (project files, imports, exports), path confinement, handling of API keys, prompt-injection paths that lead to file access or data exposure.
Out of scope: vulnerabilities in third-party AI providers or in agent hosts (Claude Code, Codex, etc.), social engineering, denial of service by opening absurdly large files.

## What we promise
No telemetry. API keys never leave your device except to the provider you configure. Atelier only reads and writes inside `~/.atelier/` and folders you explicitly choose.
