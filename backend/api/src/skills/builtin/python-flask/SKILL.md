# Python Flask Skill

## Project Structure
```
/project/
  app/
    __init__.py          # Application factory (create_app())
    extensions.py        # SQLAlchemy, migrate, jwt init
    config.py            # Config classes (Dev, Prod, Test)
    routes/              # Blueprint modules grouped by feature
      __init__.py
      users.py
      auth.py
    models/              # SQLAlchemy models
      user.py
    schemas/             # Marshmallow / Pydantic schemas for validation
    services/            # Business logic layer
    utils/               # Shared helpers
  migrations/            # Flask-Migrate auto-generated migrations
  tests/
    conftest.py          # Pytest fixtures
    test_users.py
  requirements.txt
  .env                   # Never commit
  .env.example           # Do commit
  run.py                 # Development server entry point
```

## Essential Dependencies
```
flask>=3.0
flask-sqlalchemy>=3.x
flask-migrate>=4.x
flask-jwt-extended>=4.x
marshmallow>=3.x
psycopg2-binary>=2.x    # PostgreSQL driver
python-dotenv>=1.x
pytest>=8.x
pytest-flask>=1.x
```

## Idiomatic Patterns

### Application factory
```python
# app/__init__.py
from flask import Flask
from .extensions import db, migrate, jwt

def create_app(config_name='development'):
    app = Flask(__name__)
    app.config.from_object(f'app.config.{config_name.capitalize()}Config')

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)

    from .routes.users import users_bp
    from .routes.auth import auth_bp
    app.register_blueprint(users_bp, url_prefix='/api/users')
    app.register_blueprint(auth_bp, url_prefix='/api/auth')

    return app
```

### Blueprints
```python
# app/routes/users.py
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from ..services.user_service import UserService

users_bp = Blueprint('users', __name__)

@users_bp.route('/', methods=['GET'])
@jwt_required()
def list_users():
    users = UserService.get_all()
    return jsonify([u.to_dict() for u in users])

@users_bp.route('/<int:user_id>', methods=['GET'])
@jwt_required()
def get_user(user_id):
    user = UserService.get_by_id(user_id)
    if not user:
        return jsonify(error='User not found'), 404
    return jsonify(user.to_dict())
```

### SQLAlchemy models
```python
# app/models/user.py
from datetime import datetime, UTC
from ..extensions import db
import bcrypt

class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    _password = db.Column('password', db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(UTC))

    def set_password(self, password: str) -> None:
        self._password = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    def check_password(self, password: str) -> bool:
        return bcrypt.checkpw(password.encode(), self._password.encode())

    def to_dict(self) -> dict:
        return {'id': self.id, 'email': self.email, 'created_at': self.created_at.isoformat()}
```

### Request validation
```python
from marshmallow import Schema, fields, validates, ValidationError, EXCLUDE

class CreateUserSchema(Schema):
    class Meta:
        unknown = EXCLUDE  # Ignore unknown fields

    email = fields.Email(required=True)
    password = fields.Str(required=True, load_only=True)

    @validates('password')
    def validate_password(self, value):
        if len(value) < 8:
            raise ValidationError('Password must be at least 8 characters')

# In a route:
schema = CreateUserSchema()
try:
    data = schema.load(request.get_json())
except ValidationError as e:
    return jsonify(errors=e.messages), 400
```

### Error handlers
```python
# In create_app():
@app.errorhandler(404)
def not_found(e):
    return jsonify(error='Not found'), 404

@app.errorhandler(422)
def unprocessable(e):
    return jsonify(error='Unprocessable entity'), 422

@app.errorhandler(Exception)
def handle_exception(e):
    app.logger.exception(e)
    return jsonify(error='Internal server error'), 500
```

### JWT auth routes
```python
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity

@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    user = User.query.filter_by(email=data.get('email')).first()
    if not user or not user.check_password(data.get('password', '')):
        return jsonify(error='Invalid credentials'), 401
    token = create_access_token(identity=str(user.id))
    return jsonify(access_token=token)
```

### Service layer pattern
```python
# app/services/user_service.py
from ..models.user import User
from ..extensions import db

class UserService:
    @staticmethod
    def get_all() -> list[User]:
        return User.query.order_by(User.created_at.desc()).all()

    @staticmethod
    def get_by_id(user_id: int) -> User | None:
        return User.query.get(user_id)

    @staticmethod
    def create(email: str, password: str) -> User:
        user = User(email=email)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        return user
```

## Common Pitfalls
- Importing from the app module at the top level — causes circular import errors. Use blueprints and local imports.
- Not using `db.session.commit()` after mutations — changes aren't persisted.
- Using `app.run()` in production — use gunicorn or uvicorn with a WSGI entry point.
- Not calling `db.session.rollback()` on error — leaves transactions open.
- Forgetting `Content-Type: application/json` from the client — `request.get_json()` returns `None`.
- Hardcoding secrets or database URIs — always use environment variables loaded via `python-dotenv`.
- Using mutable default arguments in Python functions — `def f(lst=[])` is a classic bug.

## Code Style
- `snake_case` for all Python names: functions, variables, file names.
- Blueprints: one per resource area (`users`, `auth`, `products`).
- Group imports: standard library → third-party → local.
- Keep route functions thin — delegate logic to service classes.
- Use type hints on function signatures.
- Run `black .` and `ruff check .` before committing.
