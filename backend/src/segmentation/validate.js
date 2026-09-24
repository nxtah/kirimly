/**
 * Validasi + cleaning baris calon mahasiswa sebelum disimpan / di-cluster.
 * Fungsi murni — tidak menyentuh DB.
 *
 * Input  : baris dengan kunci kanonik { name, phone_number, program_studi,
 *          asal_sekolah, jurusan_sekolah, domisili }
 * Aturan : nama + nomor WA wajib dan valid (ditolak bila tidak).
 *          Nomor duplikat dalam satu input → baris pertama dipakai.
 *          Variabel clustering kosong → "Tidak Diketahui" (dihitung sebagai missing value,
 *          baris tetap disimpan tetapi dikeluarkan dari clustering).
 *          Setiap perubahan nilai dicatat di `events` supaya bisa dilaporkan (tidak diam-diam).
 */

const { normalizePhone } = require('../utils/phone');
const { UNKNOWN, normalizeName, DETAIL } = require('./normalize');

const ATTRS = ['program_studi', 'asal_sekolah', 'jurusan_sekolah', 'domisili'];

/**
 * Nomor dari Excel sering kehilangan nol depan (sel numerik 0812… → 812…).
 * Nomor seluler Indonesia (8[1-9]xxxxxxx, 9–12 digit) diberi awalan 62.
 * @returns {{ digits: string, fixed: boolean }}
 */
function repairPhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (/^8[1-9]\d{7,10}$/.test(digits)) return { digits: '62' + digits, fixed: true };
  return { digits: String(raw), fixed: false };
}

const SCIENTIFIC = /^\s*\d+([.,]\d+)?\s*e\s*[+-]?\s*\d+\s*$/i;

function validateRows(rows) {
  const valid = [];
  const invalid = [];    // { index, name, phone, reason, code }
  const duplicates = []; // { index, phone_number }
  const missing = Object.fromEntries(ATTRS.map((a) => [a, 0])); // jumlah baris dengan atribut kosong
  const events = [];     // { attr, original, value, status } — bahan laporan normalisasi
  let phoneFixed = 0;
  const seen = new Set();

  rows.forEach((row, index) => {
    const name = normalizeName(row?.name);
    const rawPhone = row?.phone_number == null ? '' : String(row.phone_number);

    if (!name || !rawPhone.trim()) {
      invalid.push({ index, name: name || '(kosong)', phone: rawPhone || '(kosong)', code: 'empty', reason: 'Nama atau nomor WhatsApp kosong' });
      return;
    }

    if (SCIENTIFIC.test(rawPhone)) {
      invalid.push({ index, name, phone: rawPhone, code: 'scientific', reason: 'Nomor tersimpan sebagai notasi ilmiah (mis. 8.12E+10); ubah kolom nomor menjadi teks di Excel' });
      return;
    }

    const { digits, fixed } = repairPhone(rawPhone);
    const phone = normalizePhone(digits);
    if (!phone) {
      invalid.push({ index, name, phone: rawPhone, code: 'phone', reason: 'Format nomor WhatsApp tidak valid (10–15 digit)' });
      return;
    }

    if (seen.has(phone)) {
      duplicates.push({ index, phone_number: phone });
      return;
    }
    seen.add(phone);
    if (fixed) phoneFixed++;

    const cleaned = { name, phone_number: phone };
    for (const attr of ATTRS) {
      const detail = DETAIL[attr](row?.[attr]);
      if (detail.status === 'missing') missing[attr]++;
      cleaned[attr] = detail.value;
      events.push({ attr, original: detail.original, value: detail.value, status: detail.status });
    }
    valid.push(cleaned);
  });

  return { valid, invalid, duplicates, missing, events, phoneFixed, UNKNOWN };
}

/** Baris punya nilai lengkap untuk keempat variabel clustering? */
function isComplete(row) {
  return ATTRS.every((a) => row[a] && row[a] !== UNKNOWN);
}

module.exports = { ATTRS, validateRows, repairPhone, isComplete };
