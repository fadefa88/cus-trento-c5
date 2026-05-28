@echo off
setlocal
echo Installing dependencies...
python -m pip install -r requirements-sportrentino.txt
echo Running importer...
python scripts\import_sportrentino_news.py --max-pages 186 --sleep 0.35
pause
