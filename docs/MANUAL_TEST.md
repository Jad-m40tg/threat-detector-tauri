# Threat Detector — Manual Testing Kit

Use this guide to test every Sprint 01 rule, edge case, and failure mode directly on your laptop.

---

## 1. Single Scan Test Cases (Ready to Paste)

### Test 1.1: Legitimate HTTPS URL
- **Input:**
  ```
  https://www.example.edu/courses/cs302
  ```
- **Expected Risk:** `Low risk` (Green Pill: `Low`)
- **Expected Score:** Low score (approx 12)
- **Expected UI:** Safe status card (`Valid HTTPs protocol, standard domain layout, clean URL path`), green checkmark.

---

### Test 1.2: Insecure HTTP Protocol
- **Input:**
  ```
  http://www.example-news-blog.org/articles/guide.html
  ```
- **Expected Risk:** `Medium risk` (Amber Pill: `Medium`)
- **Triggered Rule:** Uses unencrypted HTTP protocol (+2 points).
- **Expected UI:** Caution card, warning badge.

---

### Test 1.3: Raw IP Address Hostname
- **Input:**
  ```
  http://192.168.1.50/portal/update
  ```
- **Expected Risk:** `High risk` (Red Pill: `High`)
- **Triggered Rules:** Unencrypted HTTP (+2), Hostname is a raw IP address (+4).
- **Note:** Suspicious keywords scan the **hostname only** — `portal/update` here is the path, so no keyword hit fires.
- **Expected UI:** Threat card with red glow, score ring > 80.

---

### Test 1.4: Nested / Misleading Subdomains
- **Input:**
  ```
  http://brand.account-security.example-portal.net/login
  ```
- **Expected Risk:** `High risk` (Red Pill: `High`)
- **Triggered Rules:** Multiple nested subdomains (+3), Unencrypted HTTP (+2), Suspicious keywords (+2).
- **Expected UI:** Threat card, red highlight.

---

### Test 1.5: Credential `@` Symbol in Authority
- **Input:**
  ```
  http://user:token@secure-portal.net/auth
  ```
- **Expected Risk:** `High risk` (Red Pill: `High`)
- **Triggered Rules:** Contains `@` symbol in URL authority section (+4), Unencrypted HTTP (+2), Suspicious keywords (+2 — host contains `secure` and `portal`).
- **Expected UI:** Threat card, alert notification.

---

### Test 1.6: Benign SMS / Transactional Message
- **Input:**
  ```
  Your lab appointment is confirmed for tomorrow at 2:00 PM. Reply 1 to confirm.
  ```
- **Expected Risk:** `Low risk` (Green Pill: `Low`)
- **Expected UI:** Safe status, no threat indicators.

---

### Test 1.7: Phishing Message (Urgency + Threat + Embedded IP URL)
- **Input:**
  ```
  Notice: Account verification required within 24 hours. Visit http://192.168.1.50/verify to prevent suspension.
  ```
- **Expected Risk:** `High risk` (Red Pill: `High`)
- **Triggered Rules:** Urgency time window (+2), Account suspension threat (+3), Account reference (+1), Embedded IP URL (+4), Embedded unencrypted HTTP (+2).
- **Expected UI:** Red threat card, highest risk level.

---

### Test 1.8: Mild Action / Account Digest
- **Input:**
  ```
  Please review your weekly account digest and notification settings.
  ```
- **Expected Risk:** `Medium risk` (Amber Pill: `Medium`)
- **Triggered Rules:** Action request (+1), Mentions account (+1).
- **Expected UI:** Amber caution state.

---

### Test 1.9: Punycode (Lookalike) Domain
- **Input:**
  ```
  https://xn--80ak6aa92e.com/
  ```
- **Expected Risk:** `High risk` (Red Pill: `High`)
- **Triggered Rules:** Punycode encoding in hostname (+4).
- **Expected UI:** Threat card — the "apple.com" style lookalike must never read as clean.

---

### Test 1.10: Very Long URL
- **Input:** `https://example.com/` followed by 150+ extra characters (e.g. `aaaa…`)
- **Expected Risk:** `Medium risk` (Amber Pill: `Medium`)
- **Triggered Rules:** Unusually long URL (+1).
- **Expected UI:** Caution card.

---

### Test 1.11: URL Shortener
- **Input:**
  ```
  https://bit.ly/abc123
  ```
- **Expected Risk:** `Medium risk` (Amber Pill: `Medium`)
- **Triggered Rules:** URL shortener host (+3).
- **Expected UI:** Caution card. Note: `https://xbit.ly/abc` must NOT trigger (it is not a subdomain of `bit.ly`).

---

### Test 1.12: Non-Standard Port
- **Input:**
  ```
  http://example.com:8080/
  ```
- **Expected Risk:** `Medium risk` (Amber Pill: `Medium`)
- **Triggered Rules:** Non-standard network port (+1).
- **Expected UI:** Caution card. Ports 80 (HTTP) and 443 (HTTPS) must NOT trigger.

---

## 2. Invariant & Error Test Cases

### Test 2.1: Malformed URL
- **Input:**
  ```
  ht!tp://invalid_url_format.com/test
  ```
- **Expected Result:** `Not verified` (Slate/Neutral Pill: `N/A`)
- **Expected State:** `NOT_VERIFIED` (Never Low, Never Safe).
- **Score:** None / `—`.
- **Reason:** Malformed URL format.

---

### Test 2.2: Empty / Whitespace Input
- **Input:** `   ` (or press Analyze with empty input)
- **Expected Result:** Input error inline prompt (`Please enter a URL or message to analyze`), or `Not verified` if submitted.

---

### Test 2.3: Oversized URL (>2048 chars)
- **Expected Result:** `Not verified` (Input exceeds maximum allowed length).

---

## 3. CSV Batch Tests

Under `manual-test/`:
1. `project_test_dataset.csv` (10 items): Tests all 10 canonical rows, unquoted commas, BOM, and blank row 10.
2. `bad_rows.csv`: Mixed malformed rows with valid rows — asserts malformed rows become `NotVerified` without halting valid rows.
3. `empty.csv`: 0-byte file — asserts immediate typed file error message (`The file is empty`).
4. `header_only.csv`: Header with zero data rows — asserts file has no entries to process.
5. **Cancel Mid-Batch:** Click "Clear" while a large batch is running — asserts workers abort cooperatively and state returns to idle.
