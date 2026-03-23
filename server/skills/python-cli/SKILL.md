# Python CLI Skill

## Project Structure
```
/project/
  main.py             # Entry point — parses args and dispatches commands
  commands/           # One module per CLI command
    __init__.py
    run.py
    list.py
  utils.py            # Shared helper functions
  requirements.txt    # Dependencies (click, rich, etc.)
  README.md           # Usage instructions
```

## Idiomatic Patterns

### Argument parsing
Use `argparse` (stdlib) or `click` (recommended for complex CLIs):

**argparse:**
```python
import argparse
parser = argparse.ArgumentParser(description='My tool')
parser.add_argument('command', help='Command to run')
parser.add_argument('--verbose', '-v', action='store_true')
args = parser.parse_args()
```

**click:**
```python
import click

@click.group()
def cli():
    pass

@cli.command()
@click.argument('name')
@click.option('--count', default=1, help='Number of times')
def hello(name, count):
    for _ in range(count):
        click.echo(f'Hello, {name}!')
```

### Output
- Use `print()` for simple output; use `click.echo()` or `rich` for colorized, formatted output.
- Write errors to stderr: `print('Error message', file=sys.stderr)` or `click.echo(..., err=True)`.
- Use exit codes: `sys.exit(0)` for success, `sys.exit(1)` for failure.

### File operations
- Use `pathlib.Path` instead of `os.path` for all file/directory operations.
- Always open files with context managers: `with open(path) as f:`.

## Common Pitfalls
- Not handling `KeyboardInterrupt` — CLI tools should exit cleanly on Ctrl+C.
- Printing errors to stdout — always use stderr for error messages.
- Hardcoding paths — use `pathlib.Path` and make paths configurable via arguments.
- Missing `if __name__ == '__main__':` guard prevents safe imports.
- Not validating user input before use — always check arguments exist and make sense.

## Code Style
- Use snake_case for all names: functions, variables, modules.
- Group imports: stdlib → third-party → local.
- Document each command with a clear docstring — `argparse` and `click` use it as help text.
- Keep `main.py` thin: parse args, call functions from `commands/`, handle top-level errors.
- Use type hints on function signatures for clarity.
