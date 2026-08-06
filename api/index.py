"""
api/index.py
------------
Vercel serverless function entry point.
Re-exports the Flask WSGI app so Vercel can serve it.
"""

import sys
import os

# Ensure the project root is on the import path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database as db

# Initialise the database tables on cold start
db.init_db()

from app import app
