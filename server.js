const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// SSE clients per shop: shopId -> Set of res objects
const sseClients = {};

function broadcast(shopId, event, data) {
  const clients = sseClients[shopId];
  if (!clients) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => res.write(msg));
}

function requireAuth(req, res, next) {
  const user = db.get('users').find(u => u.id === req.headers['x-user-id']);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

function requireShopRole(...roles) {
  return (req, res, next) => {
    const shopId = req.params.shopId || req.params.id;
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    if (req.user.shopId && req.user.shopId !== shopId) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  const user = db.get('users').find(u => u.id === req.body.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

app.get('/api/users', (_req, res) => res.json(db.get('users')));

// ── Shops ─────────────────────────────────────────────────────────────────────

app.get('/api/shops', (_req, res) => res.json(db.get('shops')));

app.get('/api/shops/:id', (req, res) => {
  const shop = db.get('shops').find(s => s.id === req.params.id);
  shop ? res.json(shop) : res.status(404).json({ error: 'Not found' });
});

app.put('/api/shops/:id', requireAuth, requireShopRole('owner'), (req, res) => {
  const shops = db.get('shops');
  const i = shops.findIndex(s => s.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  ['name', 'description', 'address', 'phone', 'categories', 'openingTimes']
    .forEach(k => { if (req.body[k] !== undefined) shops[i][k] = req.body[k]; });
  db.set('shops', shops);
  res.json(shops[i]);
});

// ── Products ──────────────────────────────────────────────────────────────────

app.get('/api/shops/:shopId/products', (req, res) => {
  res.json(db.get('products').filter(p => p.shopId === req.params.shopId));
});

app.post('/api/shops/:shopId/products', requireAuth, requireShopRole('owner'), (req, res) => {
  const product = {
    id: db.uid('p'),
    shopId: req.params.shopId,
    name: String(req.body.name || '').trim(),
    category: String(req.body.category || '').trim(),
    price: Math.max(0, Number(req.body.price) || 0),
    description: String(req.body.description || '').trim(),
    available: req.body.available !== false
  };
  if (!product.name) return res.status(400).json({ error: 'Name is required' });
  const products = db.get('products');
  products.push(product);
  db.set('products', products);
  res.status(201).json(product);
});

app.put('/api/shops/:shopId/products/:id', requireAuth, requireShopRole('owner'), (req, res) => {
  const products = db.get('products');
  const i = products.findIndex(p => p.id === req.params.id && p.shopId === req.params.shopId);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  ['name', 'category', 'description', 'available'].forEach(k => {
    if (req.body[k] !== undefined) products[i][k] = req.body[k];
  });
  if (req.body.price !== undefined) products[i].price = Math.max(0, Number(req.body.price) || 0);
  db.set('products', products);
  res.json(products[i]);
});

app.delete('/api/shops/:shopId/products/:id', requireAuth, requireShopRole('owner'), (req, res) => {
  const products = db.get('products');
  const i = products.findIndex(p => p.id === req.params.id && p.shopId === req.params.shopId);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  products.splice(i, 1);
  db.set('products', products);
  res.status(204).end();
});

// ── Orders ────────────────────────────────────────────────────────────────────

app.get('/api/orders', requireAuth, (req, res) => {
  if (req.user.role !== 'customer') return res.status(403).json({ error: 'Forbidden' });
  res.json(db.get('orders').filter(o => o.customerId === req.user.id));
});

app.get('/api/shops/:shopId/orders', requireAuth, requireShopRole('owner', 'kitchen', 'waiter', 'cashier', 'customer'), (req, res) => {
  const all = db.get('orders').filter(o => o.shopId === req.params.shopId);
  if (req.user.role === 'customer') {
    res.json(all.filter(o => o.customerId === req.user.id));
  } else {
    res.json(all);
  }
});

app.get('/api/shops/:shopId/orders/:id', (req, res) => {
  const order = db.get('orders').find(o => o.id === req.params.id && o.shopId === req.params.shopId);
  order ? res.json(order) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/shops/:shopId/orders', (req, res) => {
  const shop = db.get('shops').find(s => s.id === req.params.shopId);
  if (!shop) return res.status(404).json({ error: 'Shop not found' });

  const customerName = String(req.body.customerName || 'Guest').trim();
  const rawItems = req.body.items || [];
  if (!rawItems.length) return res.status(400).json({ error: 'Order must have items' });

  const newItems = rawItems.map(i => ({
    id: db.uid('i'),
    productId: i.productId,
    name: i.name,
    price: i.price,
    qty: i.qty,
    status: 'pending'
  }));

  const orders = db.get('orders');
  const existing = orders.find(
    o => o.shopId === req.params.shopId && o.customerName === customerName && o.status === 'open'
  );

  if (existing) {
    existing.items.push(...newItems);
    existing.updatedAt = new Date().toISOString();
    db.set('orders', orders);
    broadcast(req.params.shopId, 'order:updated', existing);
    return res.json(existing);
  }

  const order = {
    id: db.uid('o'),
    shopId: req.params.shopId,
    customerId: req.body.customerId || null,
    customerName,
    items: newItems,
    note: String(req.body.note || '').trim(),
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  orders.push(order);
  db.set('orders', orders);
  broadcast(req.params.shopId, 'order:new', order);
  res.status(201).json(order);
});

// Item-level status update (kitchen)
app.patch('/api/shops/:shopId/orders/:id/items/:itemId/status', requireAuth, requireShopRole('owner', 'kitchen', 'waiter'), (req, res) => {
  const VALID = ['pending', 'preparing', 'ready'];
  const { status } = req.body;
  if (!VALID.includes(status)) return res.status(400).json({ error: 'Invalid item status' });
  const orders = db.get('orders');
  const order = orders.find(o => o.id === req.params.id && o.shopId === req.params.shopId);
  if (!order) return res.status(404).json({ error: 'Not found' });
  const item = order.items.find(i => i.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  item.status = status;
  order.updatedAt = new Date().toISOString();
  db.set('orders', orders);
  broadcast(req.params.shopId, 'order:updated', order);
  res.json(order);
});

// Close the bill
app.patch('/api/shops/:shopId/orders/:id/pay', requireAuth, requireShopRole('owner', 'cashier'), (req, res) => {
  const orders = db.get('orders');
  const i = orders.findIndex(o => o.id === req.params.id && o.shopId === req.params.shopId);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  orders[i].status = 'paid';
  orders[i].updatedAt = new Date().toISOString();
  db.set('orders', orders);
  broadcast(req.params.shopId, 'order:updated', orders[i]);
  res.json(orders[i]);
});

// Cancel only
app.patch('/api/shops/:shopId/orders/:id/status', requireAuth, requireShopRole('owner', 'kitchen', 'waiter'), (req, res) => {
  const { status } = req.body;
  if (status !== 'cancelled') return res.status(400).json({ error: 'Invalid status — use /pay or /items/:id/status' });
  const orders = db.get('orders');
  const i = orders.findIndex(o => o.id === req.params.id && o.shopId === req.params.shopId);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  orders[i].status = status;
  orders[i].updatedAt = new Date().toISOString();
  db.set('orders', orders);
  broadcast(req.params.shopId, 'order:updated', orders[i]);
  res.json(orders[i]);
});

// ── SSE ───────────────────────────────────────────────────────────────────────

app.get('/api/shops/:shopId/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('event: connected\ndata: {}\n\n');
  const shopId = req.params.shopId;
  if (!sseClients[shopId]) sseClients[shopId] = new Set();
  sseClients[shopId].add(res);
  req.on('close', () => sseClients[shopId].delete(res));
});

// ── Catch-all ─────────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ShopFlow on http://localhost:${PORT}`));
