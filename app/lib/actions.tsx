"use server";

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { neon } from '@neondatabase/serverless';
 
const FormSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  amount: z.coerce.number(),
  status: z.enum(['pending', 'paid']),
  date: z.string(),
});
 
const CreateInvoice = FormSchema.omit({ id: true, date: true });
const UpdateInvoice = FormSchema.omit({ id: true, date: true });

export async function createInvoice(formData: FormData) {
  const { customerId, amount, status } = CreateInvoice.parse({
    customerId: formData.get('customerId'),
    amount: formData.get('amount'),
    status: formData.get('status'),
  });
  
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  
  // Skip database operation if no connection string
  if (!connectionString) {
    console.log('No database configured, skipping invoice creation');
    revalidatePath('/dashboard/invoices');
    redirect('/dashboard/invoices');
    return;
  }

  const amountInCents = amount * 100;
  const date = new Date().toISOString().split('T')[0];

  const sql = neon(connectionString);
  await sql`
    INSERT INTO invoices (customer_id, amount, status, date)
    VALUES (${customerId}, ${amountInCents}, ${status}, ${date})
  `;

  revalidatePath('/dashboard/invoices');
  redirect('/dashboard/invoices');
}

export async function updateInvoice(id: string, formData: FormData) {
  const { customerId, amount, status } = UpdateInvoice.parse({
    customerId: formData.get('customerId'),
    amount: formData.get('amount'),
    status: formData.get('status'),
  });
 
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.log('No database configured, skipping invoice update');
    revalidatePath('/dashboard/invoices');
    redirect('/dashboard/invoices');
    return;
  }

  const amountInCents = amount * 100;
  const sql = neon(connectionString);
 
  await sql`
    UPDATE invoices
    SET customer_id = ${customerId}, amount = ${amountInCents}, status = ${status}
    WHERE id = ${id}
  `;
 
  revalidatePath('/dashboard/invoices');
  redirect('/dashboard/invoices');
}


export async function deleteInvoice(id: string) {
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.log('No database configured, skipping invoice deletion');
    revalidatePath('/dashboard/invoices');
    redirect('/dashboard/invoices');
    return;
  }

  const sql = neon(connectionString);
  await sql`DELETE FROM invoices WHERE id = ${id}`;
  
  revalidatePath('/dashboard/invoices');
  redirect('/dashboard/invoices');
}