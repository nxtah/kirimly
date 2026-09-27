/**
 * Membangun context vector (fixed-dimension) untuk LinUCB.
 * Murni fungsi — tidak menyentuh DB. Resolusi audienceLabel dari data
 * segmentasi dilakukan di service.js (butuh query), lalu diteruskan ke sini
 * sebagai string atau null.
 *
 * Dimensi = 7 (hari, one-hot) + 4 (jam dibucket, one-hot) + 7 (audience:
 * 6 bucket hash + 1 "general") + 1 (bias) = 19.
 */

const DAY_WIDTH = 7;
const HOUR_WIDTH = 4;
const AUDIENCE_BUCKETS = 6;
const AUDIENCE_WIDTH = AUDIENCE_BUCKETS + 1; // +1 "general"
const DIMENSION = DAY_WIDTH + HOUR_WIDTH + AUDIENCE_WIDTH + 1; // +1 bias = 19

const HOUR_BUCKET_LABELS = ['night', 'morning', 'afternoon', 'evening'];

function hourBucket(hour) {
  if (hour < 6) return 0;   // night: 00-05
  if (hour < 12) return 1;  // morning: 06-11
  if (hour < 18) return 2;  // afternoon: 12-17
  return 3;                 // evening: 18-23
}

/**
 * Hash string stabil (djb2) ke salah satu dari `buckets` slot.
 * Kenapa hash, bukan one-hot per nilai unik: nilai audience (program_studi)
 * bisa berupa teks bebas yang jumlah variasinya tumbuh tanpa batas seiring
 * waktu, sementara LinUCB butuh dimensi context yang TETAP. Hash ke bucket
 * tetap ini sengaja lossy (dua nilai berbeda bisa jatuh ke bucket yang sama)
 * — trade-off MVP yang didokumentasikan, demi dimensi context yang stabil.
 */
function hashToBucket(str, buckets) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0; // hash*33 + c
  }
  return hash % buckets;
}

/**
 * @param {{dayOfWeek:number, hour:number, audienceLabel:string|null}} raw
 * @returns {{vector:number[], label:object}}
 */
function buildContext({ dayOfWeek, hour, audienceLabel }) {
  const vector = new Array(DIMENSION).fill(0);

  vector[dayOfWeek] = 1; // 0..6

  const hb = hourBucket(hour);
  vector[DAY_WIDTH + hb] = 1; // 7..10

  const audienceOffset = DAY_WIDTH + HOUR_WIDTH; // 11
  if (audienceLabel) {
    vector[audienceOffset + hashToBucket(audienceLabel, AUDIENCE_BUCKETS)] = 1; // 11..16
  } else {
    vector[audienceOffset + AUDIENCE_BUCKETS] = 1; // 17 = general
  }

  vector[DIMENSION - 1] = 1; // 18 = bias

  const label = {
    day_of_week: dayOfWeek,
    hour,
    hour_bucket: HOUR_BUCKET_LABELS[hb],
    audience_label: audienceLabel || 'general',
  };

  return { vector, label };
}

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/**
 * Peta 19 dimensi context vector secara eksplisit — indeks, kelompok, label, dan cara
 * encoding-nya. Dipakai oleh `GET /api/cmab/evaluation-config` untuk dokumentasi di halaman
 * CMAB (Evaluation Mode) supaya mapping/encoding-nya bisa diaudit, bukan cuma di komentar kode.
 */
function describeDimensions() {
  const dims = [];
  for (let i = 0; i < DAY_WIDTH; i++) {
    dims.push({ index: i, group: 'day_of_week', label: DAY_NAMES[i], encoding: 'one-hot' });
  }
  for (let i = 0; i < HOUR_WIDTH; i++) {
    dims.push({ index: DAY_WIDTH + i, group: 'hour_bucket', label: HOUR_BUCKET_LABELS[i], encoding: 'one-hot' });
  }
  const audienceOffset = DAY_WIDTH + HOUR_WIDTH;
  for (let i = 0; i < AUDIENCE_BUCKETS; i++) {
    dims.push({ index: audienceOffset + i, group: 'audience', label: `hash bucket ${i}`, encoding: 'one-hot (djb2 hash mod 6)' });
  }
  dims.push({ index: audienceOffset + AUDIENCE_BUCKETS, group: 'audience', label: 'general (tanpa audience)', encoding: 'one-hot' });
  dims.push({ index: DIMENSION - 1, group: 'bias', label: 'bias (selalu 1)', encoding: 'constant' });

  return {
    dimension: DIMENSION,
    groups: { day_of_week: DAY_WIDTH, hour_bucket: HOUR_WIDTH, audience: AUDIENCE_BUCKETS + 1, bias: 1 },
    dims,
  };
}

module.exports = { buildContext, DIMENSION, hourBucket, hashToBucket, describeDimensions };
