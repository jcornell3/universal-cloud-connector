import EventSource from 'eventsource';

console.log('Testing EventSource with named events...');

const es = new EventSource('http://127.0.0.1:3001/sse', {
  headers: {
    'Authorization': 'Bearer default-api-key'
  }
});

es.onopen = () => {
  console.log('[ONOPEN] SSE connection opened');
};

es.addEventListener('endpoint', (event) => {
  console.log('[ENDPOINT-LISTENER] Received endpoint event:', event.data);
});

es.onmessage = (event) => {
  console.log('[ONMESSAGE] Received message event:', event.data);
};

es.onerror = (err) => {
  console.log('[ONERROR] Error:', err.type, err.message);
};

setTimeout(() => {
  console.log('Closing after 5 seconds...');
  es.close();
  process.exit(0);
}, 5000);
