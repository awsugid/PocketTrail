#!/usr/bin/env python3
"""Check CI command order and failure gates without downloads or deployment."""
import os
from pathlib import Path
import subprocess
import tempfile

script = Path(__file__).with_name('cloudflare-ci.sh').resolve()
with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    bin_dir = root / 'bin'
    bin_dir.mkdir()
    (root / '.cargo').mkdir()
    (root / '.cargo/env').write_text('export RUST_ENV_LOADED=yes\n')
    compiler = root / 'toolchains/wasi-sdk-25.0-x86_64-linux/bin/clang'
    compiler.parent.mkdir(parents=True)
    compiler.write_text('#!/bin/sh\nexit 0\n')
    compiler.chmod(0o755)
    for name in ('uname', 'rustup', 'cargo', 'npm', 'curl', 'tar'):
        command = bin_dir / name
        command.write_text('''#!/bin/sh
set -eu
if [ "$(basename "$0")" = uname ]; then
    case "$1" in -s) echo Linux ;; -m) echo x86_64 ;; esac
    exit 0
fi
[ "${RUST_ENV_LOADED:-}" = yes ]
[ -x "$CC_wasm32_unknown_unknown" ]
printf '%s %s\\n' "$(basename "$0")" "$*" >> "$LOG"
[ "$(basename "$0") $*" != "${FAIL_COMMAND:-}" ]
''')
        command.chmod(0o755)
    log = root / 'log'
    env = {**os.environ, 'HOME': str(root), 'PATH': f'{bin_dir}:{os.environ["PATH"]}', 'LOG': str(log)}
    def run(mode, fail=''):
        log.write_text('')
        result = subprocess.run(['sh', str(script), mode], env={**env, 'FAIL_COMMAND': fail}, capture_output=True)
        return result.returncode, log.read_text().splitlines()
    code, commands = run('build')
    assert code == 0, commands
    assert commands == ['rustup default stable', 'rustup target add wasm32-unknown-unknown',
                        'cargo install worker-build --version 0.8.7 --locked', 'npm test', 'npm run build']
    assert run('deploy') == (0, ['npm run deploy'])
    code, commands = run('build', 'npm test')
    assert code != 0 and commands[-1] == 'npm test' and 'npm run build' not in commands
    assert run('deploy', 'npm run deploy')[0] != 0
    assert run('invalid') == (2, [])
print('PASS: CI shell command order, separate-shell environment, cached toolchains, failure gates; no network/deploy.')
