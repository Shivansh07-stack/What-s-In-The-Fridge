const fileInput = document.getElementById('fileInput');
const drop = document.getElementById('drop');
const scanBtn = document.getElementById('scanBtn');
const recipeBtn = document.getElementById('recipeBtn');
const statusEl = document.getElementById('status');
const magnetsEl = document.getElementById('magnets');
const recipeSection = document.getElementById('recipeSection');

let base64Image = null;
let mediaType = null;
let ingredients = [];

// Keep the longest edge under this — the model reads a resized fridge
// photo just as well as a full-resolution one, but it uploads and
// processes much faster.
const MAX_DIMENSION = 800;
const JPEG_QUALITY = 0.82;

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = () => reject(new Error('Could not read file'));
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > MAX_DIMENSION) {
        height = Math.round(height * (MAX_DIMENSION / width));
        width = MAX_DIMENSION;
      } else if (height > MAX_DIMENSION) {
        width = Math.round(width * (MAX_DIMENSION / height));
        height = MAX_DIMENSION;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      resolve(dataUrl);
    };
    img.onerror = () => reject(new Error('Could not load image'));
    reader.readAsDataURL(file);
  });
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  setStatus('Preparing photo…');
  try {
    const dataUrl = await resizeImage(file);
    base64Image = dataUrl.split(',')[1];
    mediaType = 'image/jpeg'; // canvas re-encodes as JPEG regardless of source
    drop.classList.add('has-img');
    drop.innerHTML = `<img src="${dataUrl}" alt="uploaded fridge photo">`;
    scanBtn.disabled = false;
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus('Could not read that image — try another file.', true);
  }
});

['dragover', 'dragenter'].forEach(evt =>
  drop.addEventListener(evt, e => e.preventDefault())
);
drop.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) {
    fileInput.files = e.dataTransfer.files;
    fileInput.dispatchEvent(new Event('change'));
  }
});

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? '#b23b3b' : '';
}

function updateMagnets(list) {
  magnetsEl.innerHTML = '';
  if (!list.length) {
    magnetsEl.innerHTML = '<span class="empty-hint">Nothing detected — fridge might genuinely be empty, or add items below</span>';
    return;
  }
  list.forEach((item, idx) => {
    const m = document.createElement('span');
    m.className = 'magnet';
    m.title = 'Click to remove';
    m.textContent = item;
    m.addEventListener('click', () => {
      ingredients.splice(idx, 1);
      updateMagnets(ingredients);
      recipeBtn.disabled = ingredients.length === 0;
    });
    magnetsEl.appendChild(m);
  });
}

function addIngredient(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  ingredients.push(trimmed);
  updateMagnets(ingredients);
  recipeBtn.disabled = false;
  setStatus(`${ingredients.length} item${ingredients.length === 1 ? '' : 's'} in the list.`);
}

const addForm = document.getElementById('addForm');
const addInput = document.getElementById('addInput');
addForm.addEventListener('submit', e => {
  e.preventDefault();
  addIngredient(addInput.value);
  addInput.value = '';
  addInput.focus();
});

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function showRecipes(recipes) {
  if (!Array.isArray(recipes) || !recipes.length) {
    recipeSection.innerHTML = '<div class="error">No recipes came back. Try scanning again.</div>';
    return;
  }
  let html = '<p class="section-title">You could make…</p><div class="recipes">';
  recipes.forEach(r => {
    const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent((r.title || 'recipe') + ' recipe');
    html += `<div class="recipe">
      <h3>${escapeHtml(r.title || 'Recipe')}</h3>
      <div class="meta">${escapeHtml(r.time || '')}${r.servings ? ' · ' + escapeHtml(r.servings) : ''}${r.uses && r.uses.length ? ' · uses ' + r.uses.map(escapeHtml).join(', ') : ''}</div>
      ${r.ingredient_list && r.ingredient_list.length ? `
        <p class="block-label">Ingredients</p>
        <ul class="ingredient-list">${r.ingredient_list.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
      ` : ''}
      <p class="block-label">Steps</p>
      <ul>${(r.steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
      ${r.tip ? `<p class="tip">💡 ${escapeHtml(r.tip)}</p>` : ''}
      ${r.shopping_suggestion ? `<p class="tip shop">🛒 ${escapeHtml(r.shopping_suggestion)}</p>` : ''}
      <a class="search-link" href="${searchUrl}" target="_blank" rel="noopener">Search for more versions of this recipe →</a>
    </div>`;
  });
  html += '</div>';
  recipeSection.innerHTML = html;
}

scanBtn.addEventListener('click', async () => {
  if (!base64Image) return;
  scanBtn.disabled = true;
  recipeBtn.disabled = true;
  setStatus('Looking through the shelves…');
  recipeSection.innerHTML = '';

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image, media_type: mediaType })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Scan failed');

    ingredients = data.ingredients;
    updateMagnets(ingredients);

    if (ingredients.length) {
      setStatus(`Found ${ingredients.length} item${ingredients.length === 1 ? '' : 's'}.`);
      recipeBtn.disabled = false;
    } else {
      setStatus("Nothing detected — if that's not right, try a brighter/closer photo, or just add items below manually.", true);
    }
  } catch (err) {
    console.error(err);
    setStatus('Something went wrong reading that photo: ' + err.message, true);
  } finally {
    scanBtn.disabled = false;
  }
});

recipeBtn.addEventListener('click', async () => {
  if (!ingredients.length) return;
  recipeBtn.disabled = true;
  setStatus('Thinking up something to cook…');
  recipeSection.innerHTML = '';

  try {
    const res = await fetch('/api/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingredients })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Recipe generation failed');

    showRecipes(data.recipes);
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus('Could not generate recipes: ' + err.message, true);
  } finally {
    recipeBtn.disabled = false;
  }
});
