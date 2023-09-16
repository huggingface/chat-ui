import { requestPdfConversion } from '$lib/server/pdfconvert/requestPdfConversion';
import { json } from '@sveltejs/kit';

export async function POST({ request }) {
    const blob = await request.blob()
    const result = await requestPdfConversion(blob);
    return json({ result }, { status: 201 });
}
