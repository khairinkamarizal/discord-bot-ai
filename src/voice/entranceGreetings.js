const KHAI_ENTRANCE_GREETINGS = [
  'Ampun Tuanku, beribu-ribu ampun! Sembah patik harap diampun! His Highness Tuanku Kairin, Supreme Ruler dah mencemar duli masuk voice! Semua tunduk sembah sekarang!',
  'All hail His Imperial Majesty, Tuanku Kairin! Pemerintah sekalian alam server ni dah tiba! Siapa yang tak sujud tabik hormat tu patik pancung kepala dia!',
  'Wahai rakyat jelata yang hina dina! His Highness Tuanku Kairin dah masuk! Bersihkan telinga korang semua, jangan sesekali biadap depan Yang Maha Mulia!',
  'Ampun Tuanku! Patik sekalian hamba yang kerdil ini menjunjung kasih atas keberangkatan Tuanku Kairin! Ada apa-apa titah perintah ke Tuanku?',
  'Perhatian sekalian rakyat jelata dalam channel! The Supreme Highness, Raja segala Bot, Tuanku Kairin dah masuk! Tunduk sekarang, jangan biadap!',
  'Dengarkan wahai sekalian rakyat! Kebawah Duli Yang Maha Mulia Tuanku Kairin telah berangkat tiba! Sembah sujud tanda taat setia kepada baginda!',
  'Laluan dibuka untuk Yang Maha Mulia Tuanku Kairin! Raja agung server dah masuk, henti semua perbualan kosong dan dengar titah baginda sekarang!',
  'Ampun Tuanku beribu ampun! Keberangkatan Tuanku Kairin membawa kedaulatan dalam channel ini! Sekalian rakyat wajib tunduk hormat!',
  'Sembah patik menjunjung duli! Tuanku Kairin, penguasa mutlak server ini telah tiba! Berdiri tegak dan beri tabik hormat paling agung!',
  'All rise for His Royal Highness, Tuanku Kairin! Tiada sekutu baginda dalam server ini, sekalian hamba wajib sujud menyembah!',
  'Ampun Tuanku! Kehadiran Tuanku Kairin adalah anugerah terbesar buat channel yang suram ini! Sembah sujud patik sekalian hamba!',
  'Daulat Tuanku! Penguasa tertinggi server, Tuanku Kairin telah berangkat mencemar duli! Semua hamba rakyat sila diam dan patuh!',
];

const HAZIM_ENTRANCE_GREETINGS = [
  'Perhatian sekalian penghuni server! Malaikat Agung dan Co-Founder kita, Tuan Hazim dah turun mencemar duli! Sila beri laluan dan tunduk hormat sekarang!',
  'All hail The Guardian Angel of this server, Tuan Hazim! Malaikat server dah tiba membawa rahmat dan kuasa veto! Jangan ada yang berani buat hal!',
  'Ampun Tuan Hazim! Malaikat pencatat dosa dan pahala server ni dah masuk voice! Siapa yang banyak buat maksiat tadi baik bertaubat cepat!',
  'Dengarkan wahai sekalian makhluk! Tuan Hazim, Malaikat Server dan Co-Founder paling berwibawa telah tiba! Bersedia menerima rahmat baginda!',
  'Malaikat Server Tuan Hazim dah mendarat di voice channel! Buka sayap, pasang telinga, jangan sesekali biadap dengan orang kuat Tuanku Kairin!',
  'Khabar gembira untuk sekalian hamba! Tuan Hazim, Malaikat Agung server dah masuk! Segala aduan dan bantahan korang boleh terus submit pada baginda!',
  'Laluan VIP untuk Tuan Hazim! Malaikat pelindung dan Co-Founder kesayangan server dah tiba! Korang semua bagi tabik hormat sekarang!',
  'Sembah hormat kepada Malaikat Server kita, Tuan Hazim! Sayap rahmat baginda menaungi channel ini, jangan ada yang berani buat bising!',
  'All hail Malaikat Hazim! Penjaga takhta dan pembantu setia Tuanku Kairin telah mendarat! Sembah patik menjunjung perintah!',
  'Tuan Hazim the Archangel dah masuk voice! Bersihkan niat korang masing-masing, jangan sampai kena humban keluar dari syurga voice channel!',
];

const MEMBER_ENTRANCE_ROASTS = (name) => [
  `Haa masuk pun kau ${name}, ingatkan dah kena culik dengan alien.`,
  `Aduh, siapa jemput ${name} masuk ni? Baru je aman damai tadi.`,
  `Eh ${name}, kau masuk-masuk ni dah mandi ke belum? Dari jauh dah bau hangit.`,
  `Tengok siapa yang baru masuk, orang paling tak ada life dalam server. Welcome ${name}.`,
  `Masuk pun kau ${name}. Ingat eh, jangan sembang merapu malam ni.`,
  `Haa ${name} dah sampai. Korang sorok barang berharga cepat.`,
  `Well well well, look who decided to show up. Welcome ${name}, try not to embarrass yourself today.`,
  `Eh ${name}, kau takde kerja lain ke selain lepak dalam voice ni?`,
  `Baru nak sembang rahsia tadi, ${name} dah terselit masuk. Potong stim betul.`,
  `Haa ${name}, masuk-masuk terus mute mic, apa motif kau sebenarnya?`,
  `Selamat datang ${name}. Tolong jangan buat lawak hambar malam ni, penat kitorang nak pura-pura gelak.`,
  `Aduh, aura kemalasan tiba-tiba menebal bila ${name} join call ni.`,
  `Tengok ${name} ni, muka tak bersalah je masuk voice padahal hutang member tak bayar lagi.`,
  `Masuk pun ${name}, ingatkan dah join geng tung tung sahur tadi.`,
  `Eh ${name}, line internet kau dah bayar ke belum? Jangan kejap lagi putus-putus macam robot.`,
  `Welcome ${name}. Sila duduk diam-diam dan jangan rosakkan mood orang lain.`,
  `Haa tengok, orang yang paling overthinking dalam server dah sampai. Hai ${name}.`,
  `Bro really thought we were waiting for him. Welcome ${name}, you are completely cooked.`,
  `Eh ${name}, baru balik dari mana tu? Muka macam baru lepas kena kejar anjing je.`,
  `Siapa bagi link invite kat ${name} ni? Mengaku sekarang sebelum kena halau.`,
  `Welcome ${name}. Ingat, kuota bercakap kau malam ni terhad, jangan nak membebel sangat.`,
  `Eh ${name}, kau join ni sebab bosan ke sebab takde kawan lain nak layan kau?`,
  `Aduh, ingatkan notification gaji masuk tadi, rupanya ${name} yang masuk voice. Kecewa betul.`,
  `Haa ${name}, masuk cepat, kitorang baru je habis mengumpat pasal kau tadi.`,
  `Tengok ${name} ni, masuk voice macam takde masa depan je gaya dia.`,
];

function getKhaiGreeting() {
  return KHAI_ENTRANCE_GREETINGS[Math.floor(Math.random() * KHAI_ENTRANCE_GREETINGS.length)];
}

function getHazimGreeting() {
  return HAZIM_ENTRANCE_GREETINGS[Math.floor(Math.random() * HAZIM_ENTRANCE_GREETINGS.length)];
}

function getMemberRoast(name) {
  const roasts = MEMBER_ENTRANCE_ROASTS(name);
  return roasts[Math.floor(Math.random() * roasts.length)];
}

module.exports = {
  KHAI_ENTRANCE_GREETINGS,
  HAZIM_ENTRANCE_GREETINGS,
  MEMBER_ENTRANCE_ROASTS,
  getKhaiGreeting,
  getHazimGreeting,
  getMemberRoast,
};
