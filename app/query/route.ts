import { neon } from '@neondatabase/serverless';

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

async function listInvoices() {
	if (!connectionString) {
		throw new Error('Database connection string is not configured');
	}
	const sql = neon(connectionString);
	const data = await sql`
    SELECT invoices.amount, customers.name
    FROM invoices
    JOIN customers ON invoices.customer_id = customers.id
    ORDER BY invoices.date DESC
    LIMIT 10;
  `;

	return data;
}

export async function GET() {
  if (!connectionString) {
    return Response.json({ error: 'POSTGRES_URL/DATABASE_URL is not configured' }, { status: 500 });
  }

  try {
    const data = await listInvoices();
    return Response.json({ data });
  } catch (error) {
    console.error('Database Error:', error);
    return Response.json({ error: 'Failed to fetch invoices' }, { status: 500 });
  }
}
