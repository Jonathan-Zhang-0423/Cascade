# Python Flask Skill

## Project Structure
```
/project/
  app.py              # Application factory and entry point
  routes/             # Blueprint modules grouped by feature
    __init__.py
    users.py
    items.py
  models.py           # SQLAlchemy models or data classes
  templates/          # Jinja2 HTML templates
    base.html
    index.html
  static/             # CSS, JS, images
  requirements.txt    # Python dependencies
  .env                # Environment variables (never commit)
```

## Idiomatic Patterns

### App factory
```python
from flask import Flask

def create_app():
    app = Flask(__name__)
    app.config.from_object('config.Config')

    from .routes.users import users_bp
    app.register_blueprint(users_bp, url_prefix='/users')

    return app
```

### Blueprints
- Use `Blueprint` to group related routes into separate modules.
- Register blueprints in the app factory with a url_prefix.

### Route handlers
- Use `@bp.route('/path', methods=['GET', 'POST'])` decorators.
- Return `jsonify(data)` for API routes; `render_template('file.html')` for web routes.
- Always validate and sanitize request data with `request.get_json()` and explicit checks.

### Error handling
- Use `@app.errorhandler(404)` and `@app.errorhandler(500)` to return clean JSON errors.
- Raise `abort(400)` for bad requests, `abort(404)` for missing resources.

## Common Pitfalls
- Importing from the app module at the top level causes circular import errors — use blueprints and lazy imports.
- Not setting `FLASK_ENV=development` means debug mode is off and changes require manual restarts.
- Missing `Content-Type: application/json` header when sending JSON from the client breaks `request.get_json()`.
- Using `app.run()` inside a factory function causes issues — run via `flask run` or a WSGI server.
- Hardcoding secrets or database URIs — always use environment variables.

## Code Style
- Use snake_case for all Python names: functions, variables, file names.
- Add docstrings to route functions explaining their purpose.
- Group imports: standard library → third-party (flask) → local modules.
- Keep route functions thin; delegate logic to helper functions or models.
- Use type hints where practical for clarity.
