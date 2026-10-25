/* =========================================================================
   ih5z — request form logic
   ========================================================================= */

/* -------------------------------------------------------------------------
   CONFIGURATION — the only block you need to edit.
   ------------------------------------------------------------------------- */

const CONFIG = {
  /* 1) Web3Forms Access Key — required.
     https://web3forms.com → enter your email → copy key → paste below.
     Click the verification link in the email Web3Forms sends you, or every
     submission will be rejected. */
  web3formsAccessKey: "f413f660-9dff-4e28-97ba-a527744e56bf",

  /* 2) Request counter — optional. URL returning {"count": N}. "" hides it. */
  counterEndpoint: "",

  /* 3) Anti-spam: seconds a human needs before submitting. */
  minFillSeconds: 5,

  /* 4) Cover upload limit in MB — Web3Forms caps attachments around 5MB total. */
  maxCoverMB: 4,

  /* 5) Debug — logs every request/response to the console. */
  debug: true
};

/* -------------------------------------------------------------------------
   Nothing below needs editing.
   ------------------------------------------------------------------------- */

const form = document.getElementById("requestForm");
const requestPanel = document.getElementById("requestPanel");
const successPanel = document.getElementById("successPanel");
const submitBtn = document.getElementById("submitBtn");
const clearBtn = document.getElementById("clearBtn");
const backHomeBtn = document.getElementById("backHomeBtn");
const formStatus = document.getElementById("formStatus");
const counterEl = document.getElementById("requestCounter");

/* cover upload elements */
const coverInput = document.getElementById("songCover");
const coverTrigger = document.getElementById("coverTrigger");
const coverTriggerLabel = document.getElementById("coverTriggerLabel");
const coverClear = document.getElementById("coverClear");
const coverPreview = document.getElementById("coverPreview");
const coverImg = document.getElementById("coverImg");
const coverName = document.getElementById("coverName");
const coverSize = document.getElementById("coverSize");

let loadedAt = Date.now();
let isSubmitting = false;
let coverFile = null;         // File object if user attached one
let coverDataUrl = null;      // base64 data URL for Web3Forms attachment
let coverPreviewUrl = null;   // local object URL for thumbnail (revoked on clear)

/* -------------------------------------------------------------- validation */

const RULES = {
  songName: (v) => {
    if (!v.trim()) return "Enter the song name.";
    if (v.trim().length < 2) return "That looks too short.";
    return "";
  },
  artistName: (v) => {
    if (!v.trim()) return "Enter the artist name.";
    if (v.trim().length < 2) return "That looks too short.";
    return "";
  },
  editStyle: (v) => (v ? "" : "Choose an edit style."),
  musicLanguage: (v) => (v ? "" : "Choose the song's language."),
  username: (v) => {
    const s = v.trim();
    if (!s) return "Username is required — I need it to credit the request.";
    if (s.length < 2) return "Username needs at least 2 characters.";
    if (s.length > 40) return "Keep it under 40 characters.";
    return "";
  },
  referenceUrl: (v) => {
    const s = v.trim();
    if (!s) return "";
    let url;
    try { url = new URL(s); }
    catch { return "Enter a full link starting with https://"; }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Link must start with http:// or https://";
    }
    return "";
  },
  details: (v) => (v.trim().length > 1000 ? "Keep it under 1000 characters." : "")
};

function setError(id, message) {
  const input = document.getElementById(id);
  const slot = document.querySelector('[data-error-for="' + id + '"]');
  const field = input && input.closest(".field");
  if (!input || !slot || !field) return;

  if (message) {
    slot.textContent = message;
    slot.classList.add("show");
    field.classList.add("invalid");
    input.setAttribute("aria-invalid", "true");
  } else {
    slot.textContent = "";
    slot.classList.remove("show");
    field.classList.remove("invalid");
    input.removeAttribute("aria-invalid");
  }
}

function clearAllErrors() {
  Object.keys(RULES).forEach((id) => setError(id, ""));
  if (coverInput) setError("songCover", "");
  hideStatus();
}

function validateForm() {
  let firstInvalid = null;

  Object.keys(RULES).forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    const message = RULES[id](input.value);
    setError(id, message);
    if (message && !firstInvalid) firstInvalid = input;
  });

  /* cover: optional, but if a file was rejected earlier show that */
  if (coverFile && coverFile.size > CONFIG.maxCoverMB * 1024 * 1024) {
    setError("songCover", "Cover is larger than " + CONFIG.maxCoverMB + " MB.");
    if (!firstInvalid) firstInvalid = coverInput;
  } else {
    setError("songCover", "");
  }

  if (firstInvalid) {
    firstInvalid.focus({ preventScroll: true });
    firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ status */

function showStatus(text) {
  formStatus.textContent = text;
  formStatus.classList.add("show");
}

function hideStatus() {
  formStatus.textContent = "";
  formStatus.classList.remove("show");
}

/* ----------------------------------------------------------------- loading */

function setLoading(loading) {
  isSubmitting = loading;
  submitBtn.disabled = loading;
  clearBtn.disabled = loading;
  submitBtn.classList.toggle("loading", loading);
  const label = submitBtn.querySelector(".btn-label");
  if (label) label.textContent = loading ? "Sending…" : "Submit request";
  form.setAttribute("aria-busy", loading ? "true" : "false");
}

/* ----------------------------------------------------------- cover handling */

function humanSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function clearCover() {
  if (coverPreviewUrl) {
    URL.revokeObjectURL(coverPreviewUrl);
    coverPreviewUrl = null;
  }
  coverFile = null;
  coverDataUrl = null;
  if (coverInput) coverInput.value = "";
  if (coverPreview) coverPreview.hidden = true;
  if (coverClear) coverClear.hidden = true;
  if (coverTriggerLabel) coverTriggerLabel.textContent = "Upload cover";
  setError("songCover", "");
}

async function handleCoverSelect() {
  setError("songCover", "");
  const file = coverInput && coverInput.files && coverInput.files[0];
  if (!file) return;

  if (!file.type || !file.type.startsWith("image/")) {
    setError("songCover", "That file isn't an image.");
    clearCover();
    return;
  }

  const maxBytes = CONFIG.maxCoverMB * 1024 * 1024;
  if (file.size > maxBytes) {
    setError("songCover", "Cover is " + humanSize(file.size) + " — max is " + CONFIG.maxCoverMB + " MB.");
    clearCover();
    return;
  }

  coverFile = file;

  /* preview */
  if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
  coverPreviewUrl = URL.createObjectURL(file);
  coverImg.src = coverPreviewUrl;
  coverName.textContent = file.name;
  coverSize.textContent = humanSize(file.size);
  coverPreview.hidden = false;
  coverClear.hidden = false;
  coverTriggerLabel.textContent = "Replace cover";

  /* base64 for Web3Forms attachment */
  try {
    coverDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  } catch {
    setError("songCover", "Could not read that file. Try a different one.");
    clearCover();
  }
}

/* ------------------------------------------------------------------ submit */

async function handleSubmit(event) {
  event.preventDefault();

  if (isSubmitting) return;
  hideStatus();

  if (form.botcheck && form.botcheck.checked) {
    if (CONFIG.debug) console.warn("[ih5z] honeypot triggered — aborted.");
    return;
  }

  const elapsed = (Date.now() - loadedAt) / 1000;
  if (elapsed < CONFIG.minFillSeconds) {
    showStatus("Hold on a moment, then submit again.");
    return;
  }

  if (!CONFIG.web3formsAccessKey || CONFIG.web3formsAccessKey === "YOUR_WEB3FORMS_ACCESS_KEY") {
    showStatus("Form is not connected — open script.js and paste your Web3Forms Access Key into CONFIG.web3formsAccessKey.");
    if (CONFIG.debug) console.error("[ih5z] Access key not configured.");
    return;
  }

  if (!validateForm()) {
    showStatus("Check the highlighted fields.");
    return;
  }

  setLoading(true);

  const payload = new FormData();
  payload.append("access_key", CONFIG.web3formsAccessKey);
  payload.append("subject", "ih5z request — " + form.Song.value.trim() + " by " + form.Artist.value.trim());
  payload.append("from_name", "ih5z requests");
  payload.append("botcheck", "");
  payload.append("Song", form.Song.value.trim());
  payload.append("Artist", form.Artist.value.trim());
  payload.append("Edit style", form["Edit style"].value);
  payload.append("Music language", form["Music language"].value);
  payload.append("Requested by", form["Requested by"].value.trim());
  payload.append("Reference link", form["Reference link"].value.trim() || "—");
  payload.append("Details", form.Details.value.trim() || "—");
  payload.append("Cover", coverFile ? coverFile.name : "—");
  payload.append("Submitted at", new Date().toISOString());

  /* Web3Forms expects attachments as base64 data-URLs in the "attachment" field. */
  if (coverDataUrl) {
    payload.append("attachment", coverDataUrl);
  }

  if (CONFIG.debug) {
    const snapshot = Object.fromEntries(payload.entries());
    if (snapshot.attachment) snapshot.attachment = "[base64 " + coverDataUrl.length + " chars]";
    console.log("[ih5z] submitting →", snapshot);
  }

  try {
    const response = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: payload
    });

    let data = {};
    try { data = await response.json(); } catch { data = {}; }

    if (CONFIG.debug) {
      console.log("[ih5z] response ←", response.status, data);
    }

    const ok = data.success === true || data.success === "true";

    if (!response.ok || !ok) {
      const reason =
        (data && data.message) ||
        (response.status === 401 || response.status === 403
          ? "Access key rejected. Verify it in your Web3Forms dashboard."
          : "Server returned HTTP " + response.status + ".");
      throw new Error(reason);
    }

    form.reset();
    clearCover();
    clearAllErrors();
    setLoading(false);
    loadedAt = Date.now();
    showSuccess();

  } catch (error) {
    setLoading(false);
    const msg = (error && error.message) ? error.message : "Network error.";
    showStatus("Could not send: " + msg);
    if (CONFIG.debug) console.error("[ih5z] submit failed:", error);
  }
}

/* ---------------------------------------------------------------- success */

function showSuccess() {
  requestPanel.hidden = true;
  successPanel.hidden = false;
  successPanel.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function backHome() {
  successPanel.hidden = true;
  requestPanel.hidden = false;
  loadedAt = Date.now();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ------------------------------------------------------------------ clear */

function clearForm() {
  form.reset();
  clearCover();
  clearAllErrors();
  const first = document.getElementById("songName");
  if (first) first.focus({ preventScroll: true });
}

/* ---------------------------------------------------------------- counter */

async function initCounter() {
  const endpoint = (CONFIG.counterEndpoint || "").trim();
  if (!endpoint) return;

  try {
    const res = await fetch(endpoint, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.count !== "number" || !Number.isFinite(data.count)) return;
    const n = data.count.toLocaleString();
    counterEl.textContent = n + " request" + (data.count === 1 ? "" : "s") + " received";
    counterEl.hidden = false;
  } catch {
    /* silent */
  }
}

/* ----------------------------------------------------------------- reveal */

function initReveal() {
  const items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("in"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  items.forEach((el) => observer.observe(el));
}

/* ------------------------------------------------------------------- wire */

form.addEventListener("submit", handleSubmit);
clearBtn.addEventListener("click", clearForm);
backHomeBtn.addEventListener("click", backHome);

Object.keys(RULES).forEach((id) => {
  const input = document.getElementById(id);
  if (!input) return;
  const evName = input.tagName === "SELECT" ? "change" : "input";
  input.addEventListener(evName, () => {
    const field = input.closest(".field");
    if (field && field.classList.contains("invalid")) {
      setError(id, RULES[id](input.value));
    }
  });
});

if (coverInput) coverInput.addEventListener("change", handleCoverSelect);
if (coverClear) coverClear.addEventListener("click", clearCover);

initReveal();
initCounter();

window.__ih5zLoaded = true;