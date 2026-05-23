-- =============================================
-- Migration 003: Kasir Auto-Sync Queue
-- Sistem antrian sinkronisasi otomatis dari kasir
-- =============================================

-- =============================================
-- TABLE: kasir_sync_batches
-- Melacak setiap proses sinkronisasi (batch)
-- =============================================

CREATE TABLE IF NOT EXISTS kasir_sync_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Waktu proses
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  -- Status batch
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'partial')),

  -- Periode data yang ditarik
  period_from DATE,
  period_to DATE,

  -- Statistik
  total_pulled  INTEGER NOT NULL DEFAULT 0,  -- total record dari API kasir
  new_count     INTEGER NOT NULL DEFAULT 0,  -- record baru yang ditambahkan ke queue
  skipped_count INTEGER NOT NULL DEFAULT 0,  -- duplikat yang dilewati

  -- Error info jika gagal
  error_message TEXT,

  -- Siapa yang memicu sync ('scheduler' | 'manual' | user UUID)
  triggered_by TEXT NOT NULL DEFAULT 'scheduler',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kasir_sync_batches_status
  ON kasir_sync_batches(status);
CREATE INDEX IF NOT EXISTS idx_kasir_sync_batches_started_at
  ON kasir_sync_batches(started_at DESC);

-- =============================================
-- TABLE: kasir_sync_queue
-- Staging area: data kasir yang menunggu konfirmasi
-- =============================================

CREATE TABLE IF NOT EXISTS kasir_sync_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Referensi ke batch sync
  batch_id UUID REFERENCES kasir_sync_batches(id) ON DELETE SET NULL,

  -- Klasifikasi item
  item_type TEXT NOT NULL CHECK (item_type IN ('penjualan', 'kas_keluar')),
  kasir_id  TEXT NOT NULL,  -- ID asli dari sistem kasir (integer disimpan sebagai text)

  -- Field umum
  tanggal DATE NOT NULL,
  waktu   TEXT NOT NULL DEFAULT '00:00:00',  -- HH:MM:SS WITA
  cabang  TEXT NOT NULL,
  branch_id UUID REFERENCES branches(id),   -- UUID cabang lokal (null = tidak cocok)

  -- Field khusus Penjualan
  total_penjualan NUMERIC,
  subtotal        NUMERIC,
  diskon          NUMERIC DEFAULT 0,
  metode_pembayaran TEXT,
  kasir_name      TEXT,

  -- Field khusus Kas Keluar
  kategori      TEXT,
  nominal       NUMERIC,
  keterangan    TEXT,
  dicatat_oleh  TEXT,

  -- Approval workflow
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'rejected')),

  confirmed_at   TIMESTAMPTZ,
  confirmed_by   UUID REFERENCES profiles(id),
  rejected_at    TIMESTAMPTZ,
  rejected_by    UUID REFERENCES profiles(id),
  reject_reason  TEXT,

  -- UUID cashflow_transactions yang dibuat saat konfirmasi
  cashflow_transaction_id UUID,

  -- Data mentah dari API untuk keperluan audit
  raw_data JSONB,

  pulled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Deduplication: cegah pull ulang transaksi kasir yang sama
  UNIQUE(item_type, kasir_id)
);

CREATE INDEX IF NOT EXISTS idx_kasir_sync_queue_status
  ON kasir_sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_kasir_sync_queue_tanggal
  ON kasir_sync_queue(tanggal DESC);
CREATE INDEX IF NOT EXISTS idx_kasir_sync_queue_type_status
  ON kasir_sync_queue(item_type, status);
CREATE INDEX IF NOT EXISTS idx_kasir_sync_queue_batch_id
  ON kasir_sync_queue(batch_id);
CREATE INDEX IF NOT EXISTS idx_kasir_sync_queue_branch
  ON kasir_sync_queue(branch_id, tanggal DESC);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

ALTER TABLE kasir_sync_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE kasir_sync_queue   ENABLE ROW LEVEL SECURITY;

-- kasir_sync_batches policies
CREATE POLICY "sync_batches_select_active" ON kasir_sync_batches
  FOR SELECT USING (is_user_active());

CREATE POLICY "sync_batches_insert_active" ON kasir_sync_batches
  FOR INSERT WITH CHECK (is_user_active());

CREATE POLICY "sync_batches_update_active" ON kasir_sync_batches
  FOR UPDATE USING (is_user_active());

-- kasir_sync_queue policies
CREATE POLICY "sync_queue_select_active" ON kasir_sync_queue
  FOR SELECT USING (is_user_active());

CREATE POLICY "sync_queue_insert_active" ON kasir_sync_queue
  FOR INSERT WITH CHECK (is_user_active());

CREATE POLICY "sync_queue_update_active" ON kasir_sync_queue
  FOR UPDATE USING (is_user_active());
