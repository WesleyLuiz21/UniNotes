import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export interface BackupManifest {
  format: 'uninotes-backup';
  formatVersion: 1;
  createdAt: string;
  database: { file: string; sha256: string; bytes: number; migrations: number; notes: number; users: number };
  attachments: { dir: string; count: number; bytes: number };
}

export const sha256File = (file: string) =>
  new Promise<string>((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });

/**
 * Verify a backup directory: manifest present, database checksum and SQLite integrity, and every
 * attachment row has a file whose SHA-256 matches. Returns a list of problems (empty = valid).
 */
export async function verifyBackup(dir: string): Promise<{ problems: string[]; manifest?: BackupManifest }> {
  const problems: string[] = [];
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { problems: ['manifest.json missing'] };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;
  if (manifest.format !== 'uninotes-backup') return { problems: ['Not a UniNotes backup'] };

  const dbFile = path.join(dir, manifest.database.file);
  if (!fs.existsSync(dbFile)) return { problems: ['Database file missing'], manifest };
  if ((await sha256File(dbFile)) !== manifest.database.sha256) problems.push('Database checksum mismatch');

  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') problems.push(`SQLite integrity check failed: ${String(integrity)}`);
    const fk = db.pragma('foreign_key_check') as unknown[];
    if (fk.length) problems.push(`${fk.length} foreign key violations`);
    const rows = db.prepare('SELECT storage_key, sha256 FROM attachments').all() as {
      storage_key: string;
      sha256: string;
    }[];
    const attDir = path.join(dir, manifest.attachments.dir);
    for (const r of rows) {
      const f = path.join(attDir, path.basename(r.storage_key));
      if (!fs.existsSync(f)) problems.push(`Attachment file missing: ${r.storage_key}`);
      else if ((await sha256File(f)) !== r.sha256)
        problems.push(`Attachment checksum mismatch: ${r.storage_key}`);
    }
  } finally {
    db.close();
  }
  return { problems, manifest };
}
