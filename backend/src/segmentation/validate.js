/**
 * Validasi + cleaning baris calon mahasiswa sebelum disimpan / di-cluster.
 * Fungsi murni — tidak menyentuh DB.
 *
 * Input  : baris dengan kunci kanonik { name, phone_number, program_studi,
 *          asal_sekolah, jurusan_sekolah, domisili }
 * Aturan : nama + nomor WA wajib dan valid (ditolak bila tidak).
 *          Atribut clustering kosong → "Tidak Diketahui" + peringatan (tidak ditolak).
 *          Nomor duplikat dalam satu input → baris pertama dipakai.
 */

const { normalizePhone } = require('../utils/phone');
const {
  UNKNOWN,
  normalizeName,
  normalizeProgramStudi,
  normalizeAsalSekolah,
  normalizeJurusanSekolah,
  normalizeDomisili,
} = require('./normalize');

const ATTRS = ['program_studi', 'asal_sekolah', 'jurusan_sekolah', 'domisili'];

const NORMALIZERS = {
  program_studi: normalizeProgramStudi,
  asal_sekolah: normalizeAsalSekolah,
  jurusan_sekolah: normalizeJurusanSekolah,
  domisili: normalizeDomisili,
};

function validateRows(rows) {
  const valid = [];
  const invalid = [];   // { index, name, phone, reason }
  const duplicates = []; // { index, phone_number }
  const missing = Object.fromEntries(ATTRS.map((a) => [a, 0])); // jumlah baris dengan atribut kosong
  const seen = new Set();

  rows.forEach((row, index) => {
    const name = normalizeName(row?.name);
    const rawPhone = row?.phone_number == null ? '' : String(row.phone_number);

    if (!name || !rawPhone.trim()) {
      invalid.push({ index, name: name || '(kosong)', phone: rawPhone || '(kosong)', reason: 'Nama atau nomor WhatsApp kosong' });
      return;
    }

    const phone = normalizePhone(rawPhone);
    if (!phone) {
      invalid.push({ index, name, phone: rawPhone, reason: 'Format nomor WhatsApp tidak valid (10–15 digit)' });
      return;
    }

    if (seen.has(phone)) {
      duplicates.push({ index, phone_number: phone });
      return;
    }
    seen.add(phone);

    const cleaned = { name, phone_number: phone };
    for (const attr of ATTRS) {
      const value = NORMALIZERS[attr](row?.[attr]);
      if (value === UNKNOWN) missing[attr]++;
      cleaned[attr] = value;
    }
    valid.push(cleaned);
  });

  return { valid, invalid, duplicates, missing };
}

module.exports = { ATTRS, validateRows };
