"""
Fridge to Recipe backend.
"""
import os
import json
import re
import base64
from pathlib import Path

from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()

API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    raise RuntimeError(
        "GEMINI_API_KEY is not set. Copy backend/.env.example to "
        "backend/.env and add your key (get one free at "
        "https://aistudio.google.com/apikey)."
    )

genai.configure(api_key=API_KEY)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")

# Free-tier friendly, fast, and supports vision.
MODEL = "gemini-3.5-flash"


def extract_json(text: str):
    """Strip markdown code fences if present, then parse JSON."""
    cleaned = re.sub(r"```json|```", "", text).strip()
    return json.loads(cleaned)


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/scan", methods=["POST"])
def scan():
    data = request.get_json(force=True)
    image_b64 = data.get("image")
    media_type = data.get("media_type", "image/jpeg")

    if not image_b64:
        return jsonify({"error": "No image provided"}), 400

    prompt = (
        "You are inventorying food from a photo of a fridge, freezer, or "
        "pantry. Scan every shelf, door bin, and drawer visible in the "
        "image systematically, front to back and top to bottom — don't "
        "stop after the first few obvious items.\n\n"
        "Rules:\n"
        "- Include an item even if it's partially hidden or you're not "
        "100% sure, as long as you can make a reasonable guess from shape, "
        "color, or packaging (e.g. a green bottle near other condiments is "
        "probably a sauce — say 'sauce (unclear type)' rather than "
        "skipping it).\n"
        "- Use specific names when the label or appearance makes it clear "
        "(e.g. 'cherry tomatoes', 'block of cheddar'), and a general name "
        "when it isn't (e.g. 'leafy greens', 'leftovers in container').\n"
        "- Don't merge separate items into one entry, and don't list the "
        "same item twice.\n"
        "- Exclude non-food items (containers, shelves, magnets) unless "
        "they're the packaging of a food item.\n\n"
        "Respond with ONLY a JSON array of strings — no markdown, no "
        "explanation. Empty array only if the photo truly has no "
        "identifiable food."
    )

    try:
        image_bytes = base64.b64decode(image_b64)
        model = genai.GenerativeModel(MODEL)
        response = model.generate_content(
            [
                {"mime_type": media_type, "data": image_bytes},
                prompt,
            ],
            generation_config={"temperature": 0.2},
        )
        ingredients = extract_json(response.text)
        if not isinstance(ingredients, list):
            raise ValueError("Model did not return a list")
        return jsonify({"ingredients": ingredients})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/recipes", methods=["POST"])
def recipes():
    data = request.get_json(force=True)
    ingredients = data.get("ingredients", [])

    if not ingredients:
        return jsonify({"error": "No ingredients provided"}), 400

    # Scale expectations to how much there actually is — asking for 3 full
    # recipes from 1-2 ingredients just pushes the model to pad with
    # invented items, so change the ask instead of fighting that.
    count = len(ingredients)
    if count <= 2:
        recipe_count = 1
        scale_note = (
            f"You only have {count} ingredient(s) to work with, which is "
            "quite limited. Suggest just 1 realistic, simple recipe using "
            "what's available plus pantry staples — don't stretch it into "
            "something elaborate. Then add a short 'shopping_suggestion' "
            "field (string) naming 2-3 common items that, if added, would "
            "unlock more variety next time."
        )
    elif count <= 4:
        recipe_count = 2
        scale_note = (
            "Suggest 2 simple, realistic recipes — keep them genuinely "
            "achievable with what's listed rather than assuming extra "
            "fresh ingredients beyond the pantry staples."
        )
    else:
        recipe_count = 3
        scale_note = "Suggest 3 recipes with some variety between them."

    prompt = (
        f"I have these ingredients available: {', '.join(ingredients)}. "
        "Assume a typical Indian household pantry is also available: "
        "salt, turmeric, red chilli powder, cumin seeds, mustard seeds, "
        "coriander powder, garam masala, ghee/oil, onion, garlic, ginger, "
        "and green chillies (only use the ones that make sense for the "
        "dish — don't force every staple into every recipe).\n\n"
        f"{scale_note}\n\n"
        "Make them **in an Indian home-cooking style** (e.g. a sabzi, "
        "dal, curry, stir-fry/bhurji, paratha filling, or similar "
        "everyday household preparation — not Western-style dishes), "
        "prioritizing using as many of the listed ingredients as "
        "possible.\n\n"
        "For each recipe, write it as a complete, self-contained recipe "
        "card — someone should be able to cook it from your output alone, "
        "without needing to look anything up. Use techniques and "
        "vocabulary familiar to Indian home cooking (e.g. 'tempering "
        "(tadka)', 'sauté onions till golden', 'add turmeric and red "
        "chilli powder', 'pressure cook for 2-3 whistles' where "
        "relevant).\n\n"
        f"Respond with ONLY a JSON array of exactly {recipe_count} "
        "item(s), no markdown fences, where each item has:\n"
        "- 'title' (string, can include the Hindi/regional name if there "
        "is a common one, e.g. 'Aloo Gobi Sabzi')\n"
        "- 'time' (string, e.g. '20 min')\n"
        "- 'servings' (string, e.g. 'Serves 2')\n"
        "- 'uses' (array of ingredient names from my list that this "
        "recipe uses)\n"
        "- 'ingredient_list' (array of strings with quantities using "
        "Indian kitchen measures where natural — cups, tbsp, tsp, or "
        "'1 katori' — e.g. '1 tsp mustard seeds', '1/2 cup diced "
        "tomatoes', 'salt to taste')\n"
        "- 'steps' (array of clear instruction strings, 4-8 steps, each "
        "one specific actionable step with times/temperatures where "
        "relevant, e.g. 'Heat 1 tbsp oil, add mustard seeds and let them "
        "splutter for 30 seconds')\n"
        "- 'tip' (string, one short serving suggestion — e.g. what to "
        "pair it with, like roti, rice, or dal)"
    )

    try:
        model = genai.GenerativeModel(MODEL)
        response = model.generate_content(prompt)
        recipe_list = extract_json(response.text)
        if not isinstance(recipe_list, list):
            raise ValueError("Model did not return a list")
        return jsonify({"recipes": recipe_list})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
