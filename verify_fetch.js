
const username = 'anshumaan';

async function testFetch(url) {
    console.log(`\n--- Testing fetch to: ${url} ---`);
    try {
        const res = await fetch(url);
        console.log(`Response Status: ${res.status}`);
        if (res.ok) {
            const data = await res.json();
            console.log('Success! Username:', data.username);
        } else {
            console.log('Failed Status:', res.statusText);
            const text = await res.text();
            console.log('Response Body:', text.substring(0, 100));
        }
    } catch (e) {
        console.error('Fetch Failed:', e.cause || e.message);
    }
}

async function run() {
    await testFetch(`http://127.0.0.1:5000/api/users/${username}/public-preview`);
    // await testFetch(`http://localhost:5000/api/users/${username}/public-preview`);
}

run();
