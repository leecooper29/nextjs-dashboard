import postgres from 'postgres';
import { neon } from '@neondatabase/serverless';
import {
  CustomerField,
  CustomersTableType,
  InvoiceForm,
  InvoicesTable,
  LatestInvoiceRaw,
  LatestInvoice,
  Revenue,
} from './definitions';
import { formatCurrency } from './utils';
import { revenue as placeholderRevenue, invoices as placeholderInvoices, customers as placeholderCustomers } from './placeholder-data';

const sql = postgres(process.env.POSTGRES_URL!, { ssl: 'require' });

export async function fetchRevenue() {
  try {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    // Fallback to placeholder data if no DB configured (avoids runtime errors during local dev)
    if (!connectionString) {
      return placeholderRevenue as Revenue[];
    }
    console.log('fetching revenue data....');
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Use Neon serverless driver for resilient TLS handling
    const neonSql = neon(connectionString);
    const data = (await neonSql`SELECT * FROM revenue`) as Revenue[];

    console.log('Data fetch completed after 3 seconds.');
 
    return data;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch revenue data.');
  }
}

export async function fetchLatestInvoices() {
  try {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      const rows = [...placeholderInvoices]
        .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
        .slice(0, 5);
      const latestInvoices: LatestInvoice[] = rows.map((inv, index) => {
        const customer = placeholderCustomers.find((c) => c.id === inv.customer_id);
        return {
          id: String(index),
          name: customer?.name ?? 'Unknown',
          image_url: customer?.image_url ?? '',
          email: customer?.email ?? '',
          amount: formatCurrency(inv.amount),
        } as LatestInvoice;
      });
      return latestInvoices;
    }

    const neonSql = neon(connectionString);
    const rows = (await neonSql`
      SELECT invoices.amount, customers.name, customers.image_url, customers.email, invoices.id
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      ORDER BY invoices.date DESC
      LIMIT 5
    `) as LatestInvoiceRaw[];

    const latestInvoices: LatestInvoice[] = rows.map((invoice) => ({
      ...invoice,
      amount: formatCurrency(invoice.amount),
    }));
    return latestInvoices;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch the latest invoices.');
  }
}

export async function fetchCardData() {
  try {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

    // Fallback to placeholder data if no DB configured
    if (!connectionString) {
      const numberOfInvoices = placeholderInvoices.length;
      const numberOfCustomers = placeholderCustomers.length;
      const paidSum = placeholderInvoices
        .filter((i) => i.status === 'paid')
        .reduce((acc, i) => acc + i.amount, 0);
      const pendingSum = placeholderInvoices
        .filter((i) => i.status === 'pending')
        .reduce((acc, i) => acc + i.amount, 0);

      return {
        numberOfCustomers,
        numberOfInvoices,
        totalPaidInvoices: formatCurrency(paidSum),
        totalPendingInvoices: formatCurrency(pendingSum),
      };
    }

    // Use Neon serverless driver to avoid TLS handshake issues
    const neonSql = neon(connectionString);
    const [invoiceCount, customerCount, invoiceStatus] = await Promise.all([
      neonSql`SELECT COUNT(*) AS count FROM invoices`,
      neonSql`SELECT COUNT(*) AS count FROM customers`,
      neonSql`SELECT
         SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS paid,
         SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS pending
       FROM invoices`,
    ]);
    const numberOfInvoices = Number(invoiceCount?.[0]?.count ?? '0');
    const numberOfCustomers = Number(customerCount?.[0]?.count ?? '0');
    const totalPaidInvoices = formatCurrency(Number(invoiceStatus?.[0]?.paid ?? 0));
    const totalPendingInvoices = formatCurrency(Number(invoiceStatus?.[0]?.pending ?? 0));

    return { numberOfCustomers, numberOfInvoices, totalPaidInvoices, totalPendingInvoices };
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch card data.');
  }
}

const ITEMS_PER_PAGE = 6;
export async function fetchFilteredInvoices(
  query: string,
  currentPage: number,
) {
  const offset = (currentPage - 1) * ITEMS_PER_PAGE;

  try {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    
    // Fallback to placeholder data if no DB configured
    if (!connectionString) {
      const filteredInvoices = placeholderInvoices
        .filter((invoice) => {
          const customer = placeholderCustomers.find(c => c.id === invoice.customer_id);
          return (
            customer?.name.toLowerCase().includes(query.toLowerCase()) ||
            customer?.email.toLowerCase().includes(query.toLowerCase()) ||
            invoice.amount.toString().includes(query) ||
            invoice.date.includes(query) ||
            invoice.status.toLowerCase().includes(query.toLowerCase())
          );
        })
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) // Sort by date descending (newest first)
        .slice(offset, offset + ITEMS_PER_PAGE)
        .map((invoice, index) => {
          const customer = placeholderCustomers.find(c => c.id === invoice.customer_id);
          return {
            id: String(index),
            amount: invoice.amount,
            date: invoice.date,
            status: invoice.status,
            name: customer?.name || 'Unknown',
            email: customer?.email || '',
            image_url: customer?.image_url || '',
          } as InvoicesTable;
        });
      return filteredInvoices;
    }

    // Use Neon serverless driver
    const neonSql = neon(connectionString);
    const invoices = (await neonSql`
      SELECT
        invoices.id,
        invoices.amount,
        invoices.date,
        invoices.status,
        customers.name,
        customers.email,
        customers.image_url
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      WHERE
        customers.name ILIKE ${`%${query}%`} OR
        customers.email ILIKE ${`%${query}%`} OR
        invoices.amount::text ILIKE ${`%${query}%`} OR
        invoices.date::text ILIKE ${`%${query}%`} OR
        invoices.status ILIKE ${`%${query}%`}
      ORDER BY invoices.date DESC
      LIMIT ${ITEMS_PER_PAGE} OFFSET ${offset}
    `) as InvoicesTable[];

    return invoices;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch invoices.');
  }
}

export async function fetchInvoicesPages(query: string) {
  try {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    
    // Fallback to placeholder data if no DB configured
    if (!connectionString) {
      const filteredCount = placeholderInvoices.filter((invoice) => {
        const customer = placeholderCustomers.find(c => c.id === invoice.customer_id);
        return (
          customer?.name.toLowerCase().includes(query.toLowerCase()) ||
          customer?.email.toLowerCase().includes(query.toLowerCase()) ||
          invoice.amount.toString().includes(query) ||
          invoice.date.includes(query) ||
          invoice.status.toLowerCase().includes(query.toLowerCase())
        );
      }).length;
      return Math.ceil(filteredCount / ITEMS_PER_PAGE);
    }

    // Use Neon serverless driver
    const neonSql = neon(connectionString);
    const data = await neonSql`SELECT COUNT(*)
    FROM invoices
    JOIN customers ON invoices.customer_id = customers.id
    WHERE
      customers.name ILIKE ${`%${query}%`} OR
      customers.email ILIKE ${`%${query}%`} OR
      invoices.amount::text ILIKE ${`%${query}%`} OR
      invoices.date::text ILIKE ${`%${query}%`} OR
      invoices.status ILIKE ${`%${query}%`}
  `;

    const totalPages = Math.ceil(Number(data[0]?.count || 0) / ITEMS_PER_PAGE);
    return totalPages;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch total number of invoices.');
  }
}

export async function fetchInvoiceById(id: string) {
  try {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    
    // Fallback to placeholder data if no DB configured
    if (!connectionString) {
      const invoice = placeholderInvoices.find((inv, index) => String(index) === id);
      if (!invoice) return undefined;
      return {
        id,
        customer_id: invoice.customer_id,
        amount: invoice.amount / 100,
        status: invoice.status,
      } as InvoiceForm;
    }

    // Use Neon serverless driver
    const neonSql = neon(connectionString);
    const data = (await neonSql`
      SELECT
        invoices.id,
        invoices.customer_id,
        invoices.amount,
        invoices.status
      FROM invoices
      WHERE invoices.id = ${id};
    `) as InvoiceForm[];

    const invoice = data.map((invoice) => ({
      ...invoice,
      // Convert amount from cents to dollars
      amount: invoice.amount / 100,
    }));

    return invoice[0];
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch invoice.');
  }
}

export async function fetchCustomers() {
  try {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    
    // Fallback to placeholder data if no DB configured
    if (!connectionString) {
      return placeholderCustomers.map(customer => ({
        id: customer.id,
        name: customer.name,
      })) as CustomerField[];
    }

    // Use Neon serverless driver
    const neonSql = neon(connectionString);
    const customers = (await neonSql`
      SELECT
        id,
        name
      FROM customers
      ORDER BY name ASC
    `) as CustomerField[];

    return customers;
  } catch (err) {
    console.error('Database Error:', err);
    throw new Error('Failed to fetch all customers.');
  }
}

export async function fetchFilteredCustomers(query: string) {
  try {
    const data = await sql<CustomersTableType[]>`
		SELECT
		  customers.id,
		  customers.name,
		  customers.email,
		  customers.image_url,
		  COUNT(invoices.id) AS total_invoices,
		  SUM(CASE WHEN invoices.status = 'pending' THEN invoices.amount ELSE 0 END) AS total_pending,
		  SUM(CASE WHEN invoices.status = 'paid' THEN invoices.amount ELSE 0 END) AS total_paid
		FROM customers
		LEFT JOIN invoices ON customers.id = invoices.customer_id
		WHERE
		  customers.name ILIKE ${`%${query}%`} OR
        customers.email ILIKE ${`%${query}%`}
		GROUP BY customers.id, customers.name, customers.email, customers.image_url
		ORDER BY customers.name ASC
	  `;

    const customers = data.map((customer) => ({
      ...customer,
      total_pending: formatCurrency(customer.total_pending),
      total_paid: formatCurrency(customer.total_paid),
    }));

    return customers;
  } catch (err) {
    console.error('Database Error:', err);
    throw new Error('Failed to fetch customer table.');
  }
}
