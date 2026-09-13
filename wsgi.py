"""
WSGI entry point for PythonAnywhere deployment
"""
import sys
import os

# Add the project directory to the path
project_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, project_dir)

# Import the Flask app
from app import app, socketio

# For PythonAnywhere - use app as the application
application = app

if __name__ == "__main__":
    socketio.run(app)
