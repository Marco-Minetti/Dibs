import { Router } from 'express';
import { query } from '../db.js';
import { ah } from '../middleware/error.js';

const router = Router();

// GET /api/schools?q=mich   → up to 10 matches for the picker
router.get('/', ah(async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) {
    const { rows } = await query(
      'select id, name, short from schools order by name limit 20'
    );
    return res.json({ schools: rows });
  }
  const { rows } = await query(
    `select id, name, short from schools
     where name ilike $1 or short ilike $1
     order by (short ilike $1) desc, name
     limit 10`,
    [`%${q}%`]
  );
  res.json({ schools: rows });
}));

export default router;
