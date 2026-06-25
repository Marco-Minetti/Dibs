import { pool, query, withTransaction } from '../src/db.js';
import { SCHOOLS } from '../src/lib/schools-seed.js';

const DEMO_PHOTO = (seed) => `https://picsum.photos/seed/${seed}/600/600`;

async function seed() {
  console.log('▸ seeding schools…');
  for (const s of SCHOOLS) {
    await query(
      `insert into schools (name, short, email_domains) values ($1,$2,$3)
       on conflict do nothing`,
      [s.name, s.short, s.domains]
    );
  }
  console.log(`  ${SCHOOLS.length} schools ready`);

  // Pick one campus for the demo data.
  const { rows: [school] } = await query(
    `select id, short, name from schools where short='NYU' limit 1`
  );

  console.log('▸ seeding demo users + listings…');
  await withTransaction(async (client) => {
    // two demo sellers + one demo buyer (all pre-verified)
    const people = [
      ['lena@nyu.edu', 'Lena', '🦊'],
      ['marco@nyu.edu', 'Marco', '🐺'],
      ['alex@nyu.edu', 'Alex', '🐱'],
    ];
    const ids = {};
    for (const [email, name, emoji] of people) {
      const { rows } = await client.query(
        `insert into users (email, email_domain, school_id, first_name, avatar_emoji, verified_at)
         values ($1,'nyu.edu',$2,$3,$4, now())
         on conflict (email) do update set first_name=excluded.first_name
         returning id`,
        [email, school.id, name, emoji]
      );
      ids[name] = rows[0].id;
    }

    const items = [
      ['Lena', 'mini fridge (kept my oat milk alive)', 4500, false, 'appliances', 'like new', 'my_room'],
      ['Lena', 'IKEA desk lamp, slightly loose neck', 800, false, 'decor', 'good', 'my_room'],
      ['Marco', 'city bike + lock, brakes 9/10', 7000, false, 'rides', 'good', 'around_campus'],
      ['Marco', 'monstera named Greg, please love him', 0, true, 'decor', 'like new', 'my_house'],
      ['Lena', '24" monitor, great for crying over essays', 6000, false, 'tech', 'like new', 'my_room'],
    ];

    for (let i = 0; i < items.length; i++) {
      const [owner, title, price, free, cat, cond, spot] = items[i];
      const { rows } = await client.query(
        `insert into listings
          (seller_id, school_id, title, price_cents, is_free, category, condition, pickup_spot, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8, now() + interval '21 days')
         returning id`,
        [ids[owner], school.id, title, price, free, cat, cond, spot]
      );
      const listingId = rows[0].id;
      for (let p = 0; p < 2; p++) {
        await client.query(
          `insert into listing_photos (listing_id, owner_id, url, position)
           values ($1,$2,$3,$4)`,
          [listingId, ids[owner], DEMO_PHOTO(`${i}-${p}`), p]
        );
      }
    }
  });

  console.log('✓ seed complete');
  console.log('\n  Demo login: request a code for  alex@nyu.edu');
  console.log('  (the code prints in this server log in dev mode)\n');
  await pool.end();
}

seed().catch((e) => { console.error(e); process.exit(1); });
