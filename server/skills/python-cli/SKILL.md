# Python CLI Skill

## Project Structure
```
/project/
  src/
    myapp/
      __init__.py         # Package init, version
      cli.py              # Main Click group / entry point
      commands/           # One module per command group
        __init__.py
        run.py
        list.py
        config.py
      core/               # Business logic (independent of CLI)
        processor.py
        validator.py
      utils/
        output.py         # Formatting helpers
        fs.py             # File system helpers
  tests/
    conftest.py
    test_commands.py
  pyproject.toml          # Package metadata and tool config
  README.md               # Usage instructions
```

## Essential Dependencies
```toml
# pyproject.toml
[project]
dependencies = [
    "click>=8.x",
    "rich>=13.x",       # Beautiful terminal output
    "typer>=0.12.x",    # Optional: Click wrapper with type hints
]

[project.scripts]
myapp = "myapp.cli:cli"
```

## Idiomatic Patterns

### Click CLI structure
```python
# myapp/cli.py
import click
from .commands.run import run
from .commands.list import list_cmd

@click.group()
@click.version_option()
@click.option('--verbose', '-v', is_flag=True, envvar='MYAPP_VERBOSE')
@click.pass_context
def cli(ctx, verbose):
    """My CLI tool — brief description."""
    ctx.ensure_object(dict)
    ctx.obj['verbose'] = verbose

cli.add_command(run)
cli.add_command(list_cmd, name='list')

if __name__ == '__main__':
    cli()
```

### Commands with Click
```python
# myapp/commands/run.py
import click
from rich.console import Console
from ..core.processor import process

console = Console()

@click.command()
@click.argument('input_file', type=click.Path(exists=True, path_type=Path))
@click.option('--output', '-o', type=click.Path(path_type=Path), help='Output path')
@click.option('--dry-run', is_flag=True, help='Preview changes without writing')
@click.pass_context
def run(ctx, input_file, output, dry_run):
    """Process INPUT_FILE and write results to OUTPUT."""
    verbose = ctx.obj.get('verbose', False)
    try:
        result = process(input_file, dry_run=dry_run)
        if verbose:
            console.print(f"Processed {result.item_count} items", style="dim")
        console.print(f"[green]✓[/green] Done: {result.summary}")
    except ValueError as e:
        console.print(f"[red]Error:[/red] {e}", err=True)
        raise click.Abort()
```

### Rich output formatting
```python
from rich.console import Console
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn

console = Console()

def print_table(items: list[dict]) -> None:
    table = Table(show_header=True, header_style="bold cyan")
    table.add_column("Name")
    table.add_column("Status")
    table.add_column("Size", justify="right")
    for item in items:
        table.add_row(item['name'], item['status'], f"{item['size']} KB")
    console.print(table)

def run_with_progress(items):
    with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}")) as p:
        task = p.add_task("Processing...", total=len(items))
        for item in items:
            process(item)
            p.advance(task)
```

### File operations with pathlib
```python
from pathlib import Path

def find_files(directory: Path, pattern: str = "*.txt") -> list[Path]:
    return sorted(directory.rglob(pattern))

def safe_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')
```

### Config file handling
```python
import json
from pathlib import Path

CONFIG_DIR = Path.home() / '.config' / 'myapp'
CONFIG_FILE = CONFIG_DIR / 'config.json'

def load_config() -> dict:
    if not CONFIG_FILE.exists():
        return {}
    return json.loads(CONFIG_FILE.read_text())

def save_config(config: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(config, indent=2))
```

### Graceful Ctrl+C handling
```python
import sys

try:
    cli()
except KeyboardInterrupt:
    console.print("\n[yellow]Aborted.[/yellow]")
    sys.exit(1)
```

### Testing CLI commands
```python
# tests/test_commands.py
from click.testing import CliRunner
from myapp.cli import cli

def test_run_command(tmp_path):
    runner = CliRunner()
    input_file = tmp_path / 'test.txt'
    input_file.write_text('hello world')
    result = runner.invoke(cli, ['run', str(input_file)])
    assert result.exit_code == 0
    assert '✓ Done' in result.output
```

## Common Pitfalls
- Not handling `KeyboardInterrupt` — CLI tools should exit cleanly on Ctrl+C.
- Printing errors to stdout — always write errors to stderr (`console.print(..., err=True)` or `click.echo(..., err=True)`).
- Using `click.Path(exists=True)` without `path_type=Path` — returns a string instead of a `Path` object.
- Forgetting `if __name__ == '__main__':` guard — prevents safe imports.
- Not using `ctx.obj` for shared context across subcommands.
- Hardcoding paths — use `pathlib.Path` and make paths configurable.
- Missing `pyproject.toml` `[project.scripts]` entry — users can't run the CLI after install.

## Code Style
- `snake_case` for all names: functions, variables, modules, file names.
- Group imports: stdlib → third-party (click, rich) → local.
- Keep command functions thin — delegate business logic to `core/`.
- Document each command with a docstring — Click uses it as `--help` text.
- Use type hints throughout for clarity and IDE support.
- Run `ruff check .` and `mypy .` before committing.
