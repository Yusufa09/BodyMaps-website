import sys
import os
from werkzeug.serving import run_simple
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))
#print("DEBUG_ENV_LOADED:", os.environ.get("SESSIONS_DIR_PATH"))

from flask import Flask
from flask_cors import CORS
from constants import Constants
#print("DEBUG_CONSTANT:", Constants.SESSIONS_DIR_NAME)

from api.api_blueprint import api_blueprint
from models.base import db
from models.combined_labels import CombinedLabels

def create_session_dir():
    if not os.path.isdir(Constants.SESSIONS_DIR_NAME):
        os.mkdir(Constants.SESSIONS_DIR_NAME)

import logging

def create_app():
    create_session_dir()
    app = Flask(__name__)
    app.register_blueprint(api_blueprint, url_prefix=f'{Constants.BASE_PATH}/api')

    class FilterProgressRequests(logging.Filter):
        def filter(self, record):
            return "/api/progress/" not in record.getMessage()

    logging.getLogger('werkzeug').addFilter(FilterProgressRequests())

    CORS(app)

    return app


app = create_app()

# ✅ SharedArrayBuffer Compatibility
@app.after_request
def add_security_headers(response):
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
    return response

def find_watch_files():
    watch_dirs = ['api', 'models', 'services']
    base_path = os.path.dirname(__file__)
    all_files = []
    for d in watch_dirs:
        dir_path = os.path.join(base_path, d)
        for root, _, files in os.walk(dir_path):
            for f in files:
                if f.endswith('.py'):
                    all_files.append(os.path.join(root, f))
    return all_files

if __name__ == "__main__":
    use_ssl = os.environ.get("USE_SSL", "false").lower() == "true"
    ssl_context = ("../certs/localhost-cert.pem", "../certs/localhost-key.pem") if use_ssl else None
    run_simple(
        hostname="0.0.0.0",
        port=5001,
        application=app,
        use_debugger=True,
        use_reloader=True,
        extra_files=find_watch_files(),
        ssl_context=ssl_context
    )