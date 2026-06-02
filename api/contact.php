<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function respond(int $status, array $payload): void {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, ['ok' => false, 'message' => 'Metodo non consentito.']);
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$host = $_SERVER['HTTP_HOST'] ?? '';
if ($origin !== '') {
    $originHost = parse_url($origin, PHP_URL_HOST);
    if ($originHost && $host && strcasecmp($originHost, $host) !== 0) {
        respond(403, ['ok' => false, 'message' => 'Origine non autorizzata.']);
    }
}

$raw = file_get_contents('php://input') ?: '';
$data = json_decode($raw, true);
if (!is_array($data)) {
    $data = $_POST;
}

$honeypot = trim((string)($data['website'] ?? $data['bot-field'] ?? ''));
if ($honeypot !== '') {
    respond(200, ['ok' => true, 'message' => 'Messaggio inviato correttamente.']);
}

function cut_text(string $value, int $max): string {
    return function_exists('mb_substr') ? mb_substr($value, 0, $max, 'UTF-8') : substr($value, 0, $max);
}

function text_length(string $value): int {
    return function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
}

function field(array $data, string $key, int $max = 500): string {
    $value = trim((string)($data[$key] ?? ''));
    $value = preg_replace('/[\x00-\x1F\x7F]/u', ' ', $value) ?? '';
    $value = preg_replace('/\s+/u', ' ', $value) ?? '';
    return cut_text($value, $max);
}

function multiline_field(array $data, string $key, int $max = 4000): string {
    $value = trim((string)($data[$key] ?? ''));
    $value = str_replace(["\r\n", "\r"], "\n", $value);
    $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value) ?? '';
    return cut_text($value, $max);
}

$name = field($data, 'name', 120);
$email = field($data, 'email', 180);
$phone = field($data, 'phone', 80);
$reason = field($data, 'reason', 120);
$message = multiline_field($data, 'message', 4000);
$privacy = isset($data['privacy']) && (string)$data['privacy'] !== '';

if ($name === '' || $email === '' || $message === '' || !$privacy) {
    respond(422, ['ok' => false, 'message' => 'Compila nome, email, messaggio e consenso privacy.']);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(422, ['ok' => false, 'message' => 'Inserisci un indirizzo email valido.']);
}
if (text_length($message) < 10) {
    respond(422, ['ok' => false, 'message' => 'Il messaggio è troppo breve.']);
}

$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$rateFile = sys_get_temp_dir() . '/cus_contact_' . hash('sha256', $ip);
$now = time();
if (is_file($rateFile)) {
    $last = (int)file_get_contents($rateFile);
    if ($last > 0 && ($now - $last) < 45) {
        respond(429, ['ok' => false, 'message' => 'Hai inviato una richiesta da poco. Attendi qualche secondo e riprova.']);
    }
}
@file_put_contents($rateFile, (string)$now, LOCK_EX);

$to = 'luca.defassi@gmail.com';
$from = getenv('CUS_CONTACT_FROM') ?: 'no-reply@custrentocalcioa5.it';
$subject = '[CUS Trento C5] Nuovo messaggio: ' . ($reason !== '' ? $reason : 'Contatto sito');

$body = "Nuovo messaggio dal sito CUS Trento Calcio a 5\n\n"
    . "Nome: {$name}\n"
    . "Email: {$email}\n"
    . "Telefono: " . ($phone !== '' ? $phone : '-') . "\n"
    . "Motivo: " . ($reason !== '' ? $reason : '-') . "\n\n"
    . "Messaggio:\n{$message}\n\n"
    . "---\n"
    . "Data: " . date('Y-m-d H:i:s') . "\n"
    . "IP: {$ip}\n"
    . "User-Agent: " . ($_SERVER['HTTP_USER_AGENT'] ?? '-') . "\n";

$encodedSubject = function_exists('mb_encode_mimeheader')
    ? mb_encode_mimeheader($subject, 'UTF-8', 'B', "\r\n")
    : $subject;

$headers = [];
$headers[] = 'MIME-Version: 1.0';
$headers[] = 'Content-Type: text/plain; charset=UTF-8';
$headers[] = 'Content-Transfer-Encoding: 8bit';
$headers[] = 'From: CUS Trento C5 <' . $from . '>';
$headers[] = 'Reply-To: ' . $name . ' <' . $email . '>';
$headers[] = 'X-Mailer: CUS Trento C5 contact form';

$sent = @mail($to, $encodedSubject, $body, implode("\r\n", $headers), '-f' . $from);
if (!$sent) {
    respond(500, ['ok' => false, 'message' => 'Il server non è riuscito a inviare il messaggio. Scrivi direttamente a custrentocalcio@gmail.com.']);
}

respond(200, ['ok' => true, 'message' => 'Messaggio inviato correttamente. Ti risponderemo appena possibile.']);
