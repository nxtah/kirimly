/**
 * Reward untuk CMAB — dihitung dari kolom agregat `blasts` yang sudah ada
 * (dijaga benar oleh messageTrackingService, tidak disentuh di sini).
 *
 * Reward per pesan (spec): 0.2×delivered + 0.3×read + 0.5×replied
 * (nested: replied ⟹ read ⟹ delivered, sesuai semantik tracking existing).
 * Untuk satu blast (banyak kontak), reward campaign = rata-rata reward per
 * pesan di seluruh kontak target — yaitu jumlah reward per-pesan dibagi
 * total_contacts. Karena delivered/read/replied_count masing-masing sudah
 * berupa hitungan kumulatif per status, ini aljabar-nya persis sama dengan:
 *
 *   reward = 0.2×(delivered_count/T) + 0.3×(read_count/T) + 0.5×(replied_count/T)
 *
 * Kontak yang gagal/pending tidak masuk hitungan manapun → otomatis
 * berkontribusi 0, sesuai spec ("jika gagal dikirim, reward = 0").
 */
function computeReward(blast) {
  const T = blast.total_contacts;
  if (!T || T <= 0) return 0; // tidak ada kontak target → reward tidak terdefinisi, anggap 0

  const deliveredRate = blast.delivered_count / T;
  const readRate = blast.read_count / T;
  const repliedRate = blast.replied_count / T;

  return 0.2 * deliveredRate + 0.3 * readRate + 0.5 * repliedRate;
}

module.exports = { computeReward };
