import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { requirePerm } from '../auth.js';
import { createLogicalBackup, restoreLogicalBackup, autoBackupNow, listBackups, BACKUPS_DIR } from '../backup.js';
import { audit } from '../util.js';

export const backupRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// Скачать логический бэкап (JSON)
backupRouter.get('/download', requirePerm('admin.backup'), (req, res) => {
  const payload = createLogicalBackup(req.user.name);
  audit(req.user.id, 'backup.download', 'database', null, payload.counts);
  const filename = `campuscrm-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(payload, null, 2));
});

// Восстановить из бэкапа
backupRouter.post('/restore', requirePerm('admin.backup'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  try {
    const payload = JSON.parse(req.file.buffer.toString('utf-8'));
    // Страховочная точка перед восстановлением
    autoBackupNow();
    const { restored } = restoreLogicalBackup(payload, req.user.id);
    res.json({ ok: true, restored, backup_from: payload.created_at });
  } catch (e) {
    res.status(400).json({ error: `Не удалось восстановить: ${e.message}` });
  }
});

// Список автобэкапов
backupRouter.get('/list', requirePerm('admin.backup'), (_req, res) => {
  res.json({ backups: listBackups() });
});

// Принудительно создать автобэкап
backupRouter.post('/snapshot', requirePerm('admin.backup'), (req, res) => {
  try {
    const file = autoBackupNow();
    audit(req.user.id, 'backup.snapshot', 'database', null, { file: path.basename(file) });
    res.json({ ok: true, file: path.basename(file) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Скачать конкретный автобэкап (сырой файл БД)
backupRouter.get('/file/:name', requirePerm('admin.backup'), (req, res) => {
  const name = path.basename(req.params.name); // защита от path traversal
  const full = path.join(BACKUPS_DIR, name);
  if (!fs.existsSync(full) || !name.endsWith('.db')) return res.status(404).json({ error: 'Бэкап не найден' });
  res.download(full, `campuscrm-${name}`);
});
