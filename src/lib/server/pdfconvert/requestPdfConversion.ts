import { MATHPIX_APP_ID, MATHPIX_APP_KEY } from "$env/static/private";

type MathpixOptions = {
  conversion_formats: {
    'md': boolean;
    'docx': boolean;
    'tex.zip': boolean;
    'html': boolean;
  };
  math_inline_delimiters: string[];
  rm_spaces: boolean;
};

const defaultOptions: MathpixOptions = {
  conversion_formats: {
    'md': true,
    'docx': false,
    'tex.zip': false,
    'html': false,
  },
  math_inline_delimiters: ['$', '$'],
  rm_spaces: true,
};

// See https://docs.mathpix.com/#process-a-pdf
async function requestPdfConversion(file: Blob, option: MathpixOptions = defaultOptions): Promise<string> {
  const BASE_URL = 'https://api.mathpix.com/v3';
  const headers = {
    'app_id': MATHPIX_APP_ID,
    'app_key': MATHPIX_APP_KEY
  };

  // Start the conversion
  const formData = new FormData();
  formData.append('file', file);
  formData.append('options_json', JSON.stringify(option));

  const initialResponse = await fetch(`${BASE_URL}/pdf`, {
    method: 'POST',
    headers: headers,
    body: formData
  });

  const { pdf_id } = await initialResponse.json();

  // Check conversion status
  let conversionCompleted = false;
  while (!conversionCompleted) {
    const statusResponse = await fetch(`${BASE_URL}/converter/${pdf_id}`, {
      method: 'GET',
      headers: headers
    });

    const statusData = await statusResponse.json();
    if (statusData.status === "completed") {
      conversionCompleted = true;
    } else {
      // Wait for a 1 second before polling again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Fetch the markdown data
  const markdownResponse = await fetch(`${BASE_URL}/converter/${pdf_id}.md`, {
    method: 'GET',
    headers: headers
  });

  return await markdownResponse.text();
}

export { requestPdfConversion };