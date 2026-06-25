const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";
const TURNSTILE_VERIFY_ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function clean(value, max = 4000) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

async function readPayload(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await request.json();
  }
  const formData = await request.formData();
  return Object.fromEntries(formData.entries());
}

async function verifyTurnstile(token, secret, ip) {
  const formData = new FormData();
  formData.append("secret", secret);
  formData.append("response", token);
  if (ip) formData.append("remoteip", ip);

  const response = await fetch(TURNSTILE_VERIFY_ENDPOINT, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) return { success: false, error: "turnstile_http_error" };
  return await response.json();
}

export async function onRequestOptions() {
  return jsonResponse({ ok: true });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.TURNSTILE_SECRET_KEY || !env.WEB3FORMS_ACCESS_KEY) {
    return jsonResponse({ success: false, message: "Configurazione form incompleta." }, 500);
  }

  let payload;
  try {
    payload = await readPayload(request);
  } catch (error) {
    return jsonResponse({ success: false, message: "Richiesta non valida." }, 400);
  }

  // Honeypot legacy: return a harmless success, but do not forward spam.
  if (payload.botcheck || clean(payload.website, 200)) {
    return jsonResponse({ success: true, ok: true, message: "Messaggio ricevuto." });
  }

  const token = clean(payload["cf-turnstile-response"], 4096);
  if (!token) {
    return jsonResponse({ success: false, message: "Verifica antispam mancante." }, 400);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const turnstile = await verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, ip);
  if (!turnstile.success) {
    return jsonResponse({ success: false, message: "Verifica antispam non superata." }, 400);
  }

  const name = clean(payload.name, 180);
  const email = clean(payload.email, 240);
  const phone = clean(payload.phone, 80);
  const reason = clean(payload.reason, 140) || "Contatto";
  const message = clean(payload.message, 4000);
  const company = clean(payload.company, 180);
  const packageName = clean(payload.package, 180);
  const subject = clean(payload.subject, 180) || "Nuovo messaggio dal sito CUS Trento C5";

  if (!name || !email || !isEmail(email) || !message || message.length < 10) {
    return jsonResponse({ success: false, message: "Compila nome, email valida e messaggio." }, 400);
  }

  const web3Payload = {
    access_key: env.WEB3FORMS_ACCESS_KEY,
    subject,
    from_name: "CUS Trento C5 website",
    name,
    email,
    phone,
    reason,
    message,
    privacy: payload.privacy ? "accepted" : "missing",
  };

  if (company) web3Payload.company = company;
  if (packageName) web3Payload.package = packageName;

  const response = await fetch(WEB3FORMS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(web3Payload),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !(result.success || result.ok)) {
    return jsonResponse({ success: false, message: result.message || "Invio non riuscito. Riprova più tardi." }, 502);
  }

  return jsonResponse({ success: true, ok: true, message: "Messaggio inviato correttamente." });
}

export async function onRequest() {
  return jsonResponse({ success: false, message: "Metodo non consentito." }, 405);
}
