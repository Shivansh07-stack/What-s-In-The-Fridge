# Fridge to Recipe

A small app that takes a photo of your fridge, uses Gemini's vision to figure out what ingredients you have, and then suggests recipes based on what's available.

It's a simple Flask backend serving a vanilla HTML/JS frontend. Classic pipeline: vision extraction -> text generation -> UI render.

## Running it

You need a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey). The free tier works fine.

1. Install the backend dependencies:
```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

2. Set up your config:
```bash
cd backend
cp .env.example .env
```
Paste your API key into `.env`.

3. Start the server:
```bash
python app.py
```
It runs on `http://localhost:5000`.

## Notes
- We're currently using `gemini-2.5-flash` because it's fast and on the free tier. If it starts throwing quota errors, Google might have moved it. Just check their docs and bump the model name in `app.py`.
- No database yet. Everything just runs in memory/frontend.
