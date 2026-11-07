/**
 * End-to-end smoke test against a running API.
 *
 *   npm run build && PORT=4111 node dist/src/main.js &
 *   API_BASE=http://localhost:4111/api npm run test:smoke
 *
 * It creates throwaway accounts, so point it at a development database.
 */
const BASE = process.env.API_BASE || 'http://localhost:4000/api';
let pass = 0, fail = 0;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${extra}`); }
}

(async () => {
  const stamp = Date.now();
  const studioEmail = `studio${stamp}@example.com`;
  const crewEmail = `crew${stamp}@example.com`;
  const password = 'Str0ngPassw0rd!';

  console.log('\n[auth]');
  const health = await call('GET', '/health');
  check('GET /health is public', health.status === 200, JSON.stringify(health.data));

  const reg = await call('POST', '/auth/register', {
    body: { email: studioEmail, password, firstName: 'Olim', lastName: 'Studio' },
  });
  check('register returns access_token', !!reg.data?.access_token, JSON.stringify(reg.data));
  check('register returns user object', !!reg.data?.user?.id, JSON.stringify(reg.data));

  const login = await call('POST', '/auth/login', { body: { email: studioEmail, password } });
  check('login returns access_token', !!login.data?.access_token);
  check('login returns user with roles array', Array.isArray(login.data?.user?.roles),
        JSON.stringify(login.data?.user));

  const badLogin = await call('POST', '/auth/login', { body: { email: studioEmail, password: 'wrong' } });
  check('bad password -> 401', badLogin.status === 401, badLogin.status);

  let token = login.data.access_token;
  const me = await call('GET', '/auth/me', { token });
  check('GET /auth/me works', me.data?.email === studioEmail, JSON.stringify(me.data));

  console.log('\n[security]');
  const noAuth = await call('GET', '/users/' + me.data.id);
  check('GET /users/:id without token -> 401', noAuth.status === 401, noAuth.status);
  const noAuthTeam = await call('POST', '/users/team/invite', { body: { workerPublicId: 'TM-111111' } });
  check('POST /users/team/invite without token -> 401', noAuthTeam.status === 401, noAuthTeam.status);
  const noAuthBookings = await call('GET', '/bookings');
  check('GET /bookings without token -> 401', noAuthBookings.status === 401, noAuthBookings.status);

  console.log('\n[onboarding]');
  const onboard = await call('POST', '/auth/onboarding', {
    token,
    body: {
      role: 'STUDIO', whatsapp: '+998901234567',
      firstName: 'Olim', lastName: 'Studio',
      studioName: 'Olim Studio', studioLocation: 'Tashkent',
    },
  });
  check('studio onboarding returns new token', !!onboard.data?.access_token, JSON.stringify(onboard.data));
  check('onboarding persists firstName', onboard.data?.user?.firstName === 'Olim');
  check('onboarding sets studioId', !!onboard.data?.user?.studioId);
  check('onboarding grants ADMIN role', onboard.data?.user?.roles?.includes('ADMIN'),
        JSON.stringify(onboard.data?.user?.roles));
  token = onboard.data.access_token;
  const studioId = onboard.data.user.studioId;

  const rejectExtra = await call('POST', '/auth/onboarding', {
    token, body: { role: 'STUDIO', whatsapp: '+998901234567', fullName: 'Olim Studio' },
  });
  check('unknown field `fullName` is now rejected (400)', rejectExtra.status === 400,
        JSON.stringify(rejectExtra.data));

  console.log('\n[clients]');
  const client = await call('POST', '/clients', {
    token,
    body: { firstName: 'Sarah', lastName: 'Smith', phone: '+12125551234', instagramHandle: '@sarah' },
  });
  check('create client -> 201', client.status === 201, JSON.stringify(client.data));
  check('instagramHandle is persisted', client.data?.instagramHandle === '@sarah',
        JSON.stringify(client.data));
  check('client scoped to caller studio', client.data?.studioId === studioId);

  const clients = await call('GET', '/clients', { token });
  check('GET /clients (no studioId param needed)', Array.isArray(clients.data) && clients.data.length === 1);

  console.log('\n[bookings]');
  const booking = await call('POST', '/bookings', {
    token,
    body: {
      clientId: client.data.id, title: 'Sarah & David Wedding', eventType: 'Wedding',
      eventDate: '2026-11-20T00:00:00.000Z', agreedPrice: 7500,
      people: [{ personType: 'bride', firstName: 'Sarah' }],
      parts: [{
        partType: 'Ceremony', venueName: 'Plaza Hotel', city: 'NYC',
        startAt: '2026-11-20T15:00:00.000Z', endAt: '2026-11-20T18:00:00.000Z',
      }],
    },
  });
  check('create booking -> 201', booking.status === 201, JSON.stringify(booking.data));
  check('booking status is DRAFT enum', booking.data?.status === 'DRAFT', booking.data?.status);
  check('booking parts created', booking.data?.eventParts?.length === 1);
  const bookingId = booking.data.id;

  // A studio can create the client and the booking in one call.
  const inlineBooking = await call('POST', '/bookings', {
    token,
    body: {
      client: { firstName: 'Priya', lastName: 'Nair', phone: '+1 (415) 555-2020', instagramHandle: '@priya' },
      title: 'Nair Engagement', eventType: 'Engagement',
      eventDate: '2026-12-05T00:00:00.000Z', agreedPrice: 2200,
    },
  });
  check('booking creates its client inline', inlineBooking.status === 201, JSON.stringify(inlineBooking.data));
  check('the inline client is attached and scoped to the studio',
        inlineBooking.data?.client?.firstName === 'Priya' &&
          inlineBooking.data?.client?.studioId === studioId,
        JSON.stringify(inlineBooking.data?.client));
  check('the inline client keeps optional fields',
        inlineBooking.data?.client?.instagramHandle === '@priya');

  const clientsAfter = await call('GET', '/clients', { token });
  check('the inline client shows up in the client list',
        clientsAfter.data.some((c) => c.firstName === 'Priya'),
        JSON.stringify(clientsAfter.data.map((c) => c.firstName)));

  const bothIds = await call('POST', '/bookings', {
    token,
    body: { clientId: client.data.id, client: { firstName: 'X' }, title: 'T', eventType: 'Wedding',
            eventDate: '2026-12-05T00:00:00.000Z' },
  });
  check('sending both clientId and client is refused', bothIds.status === 400, JSON.stringify(bothIds.data));

  const neitherId = await call('POST', '/bookings', {
    token, body: { title: 'T', eventType: 'Wedding', eventDate: '2026-12-05T00:00:00.000Z' } });
  check('sending neither is refused', neitherId.status === 400, JSON.stringify(neitherId.data));

  const clientsBeforeFailure = (await call('GET', '/clients', { token })).data.length;
  const badInline = await call('POST', '/bookings', {
    token,
    body: { client: { firstName: 'Ghost' }, title: 'Bad', eventType: 'Wedding',
            eventDate: 'not-a-date' },
  });
  const clientsAfterFailure = (await call('GET', '/clients', { token })).data.length;
  check('a rejected booking leaves no stray client',
        badInline.status === 400 && clientsAfterFailure === clientsBeforeFailure,
        `status ${badInline.status}, clients ${clientsBeforeFailure} -> ${clientsAfterFailure}`);

  console.log('\n[editing]');
  const renamed = await call('PATCH', `/bookings/${bookingId}`, {
    token, body: { title: 'Renamed Wedding', agreedPrice: 7900 } });
  check('a booking can be renamed and repriced',
        renamed.data?.title === 'Renamed Wedding' && Number(renamed.data?.agreedPrice) === 7900,
        JSON.stringify({ title: renamed.data?.title, price: renamed.data?.agreedPrice }));

  const advanced = await call('PATCH', `/bookings/${bookingId}`, {
    token, body: { status: 'IN_PROGRESS' } });
  check('a booking can move along its lifecycle', advanced.data?.status === 'IN_PROGRESS',
        advanced.data?.status);

  await call('PATCH', `/bookings/${bookingId}`, {
    token, body: { title: 'Sarah & David Wedding', agreedPrice: 7500, status: 'CONFIRMED' } });

  const editedClient = await call('PATCH', `/clients/${client.data.id}`, {
    token, body: { instagramHandle: '@updated' } });
  check('a client can be edited', editedClient.data?.instagramHandle === '@updated',
        JSON.stringify(editedClient.data));

  const throwaway = await call('POST', '/clients', { token, body: { firstName: 'Throwaway' } });
  const removed = await call('DELETE', `/clients/${throwaway.data.id}`, { token });
  check('a client can be deleted', removed.status === 200, removed.status);
  const gone = await call('GET', `/clients/${throwaway.data.id}`, { token });
  check('the deleted client is gone', gone.status === 404, gone.status);

  console.log('\n[crew + creative]');
  const crewReg = await call('POST', '/auth/register', {
    body: { email: crewEmail, password, firstName: 'Aziz', lastName: 'Photo' },
  });
  let crewToken = crewReg.data.access_token;
  const crewOnboard = await call('POST', '/auth/onboarding', {
    token: crewToken,
    body: { role: 'CREATIVE', whatsapp: '+998901112233', firstName: 'Aziz', lastName: 'Photo',
            specialization: 'Photographer', primaryGear: 'Sony A7IV' },
  });
  crewToken = crewOnboard.data.access_token;
  const workerPublicId = crewOnboard.data.user.workerPublicId;
  check('creative gets TM- public id', /^TM-\d{6}$/.test(workerPublicId || ''), workerPublicId);
  check('primaryGear persisted', (await call('GET', '/users/' + crewOnboard.data.user.id, { token: crewToken }))
        .data?.workerProfile?.primaryGear === 'Sony A7IV');

  const invite = await call('POST', '/users/team/invite', { token, body: { workerPublicId } });
  check('invite by TM- id works', invite.status === 201, JSON.stringify(invite.data));

  const inviteLower = await call('POST', '/users/team/invite', { token, body: { workerPublicId: workerPublicId.toLowerCase() } });
  check('invite tolerates lowercase id', inviteLower.status === 201 || inviteLower.status === 400,
        JSON.stringify(inviteLower.data));

  const notifs = await call('GET', '/users/notifications', { token: crewToken });
  check('creative sees invite notification', notifs.data?.length >= 1, JSON.stringify(notifs.data));

  const respond = await call('POST', '/users/team/respond', {
    token: crewToken, body: { studioId, action: 'accept' },
  });
  check('creative accepts invite', respond.data?.success === true, JSON.stringify(respond.data));

  const team = await call('GET', '/users/team', { token });
  check('team list has active member', team.data?.active?.length >= 1, JSON.stringify(team.data));
  check('team member has fullName', !!team.data?.active?.[0]?.fullName, JSON.stringify(team.data?.active?.[0]));

  console.log('\n[profile]');
  const updated = await call('PATCH', '/users/me', {
    token: crewToken,
    body: { firstName: 'Azizbek', primaryRole: 'Lead Videographer', bio: 'Wedding films' },
  });
  check('PATCH /users/me updates the caller', updated.data?.firstName === 'Azizbek',
        JSON.stringify(updated.data));
  check('worker-profile fields are applied',
        updated.data?.workerProfile?.primaryRole === 'Lead Videographer',
        JSON.stringify(updated.data?.workerProfile));
  const forbiddenField = await call('PATCH', '/users/me', {
    token: crewToken, body: { email: 'hacker@example.com' },
  });
  check('email cannot be changed through the profile endpoint',
        forbiddenField.status === 400, forbiddenField.status);

  console.log('\n[assignments]');
  const assign = await call('POST', '/crew-assignments', {
    token,
    body: {
      bookingId, workerId: crewOnboard.data.user.workerProfileId,
      role: 'Photographer', agreedFee: 1200,
      eventPartIds: [booking.data.eventParts[0].id],
    },
  });
  check('create assignment -> 201', assign.status === 201, JSON.stringify(assign.data));
  check('assignment default status ASSIGNED', assign.data?.status === 'ASSIGNED', assign.data?.status);
  const assignmentId = assign.data.id;

  // The studio owner is a team member but has no creative profile, so they
  // cannot be booked as crew - the error should say so, not echo an id.
  const ownerAssign = await call('POST', '/crew-assignments', {
    token,
    body: { bookingId, workerId: onboard.data.user.id, role: 'Photographer', agreedFee: 100 },
  });
  check('assigning a non-creative gives a readable error',
        ownerAssign.status === 400 &&
          /does not have a creative profile/.test(ownerAssign.data?.message || ''),
        JSON.stringify(ownerAssign.data));

  const teamShape = await call('GET', '/users/team', { token });
  check('team rows say who is bookable via workerProfileId',
        teamShape.data.active.some((m) => m.workerProfileId === null) &&
          teamShape.data.active.some((m) => m.workerProfileId !== null),
        JSON.stringify(teamShape.data.active.map((m) => [m.fullName, m.workerProfileId])));

  const badStatus = await call('PATCH', `/crew-assignments/${assignmentId}/respond`, {
    token: crewToken, body: { status: 'ACCEPTED' },
  });
  check('legacy "ACCEPTED" is rejected (400)', badStatus.status === 400, JSON.stringify(badStatus.data));

  const wrongPerson = await call('PATCH', `/crew-assignments/${assignmentId}/respond`, {
    token, body: { status: 'CONFIRMED' },
  });
  check('studio cannot answer on behalf of worker (403)', wrongPerson.status === 403, wrongPerson.status);

  const accept = await call('PATCH', `/crew-assignments/${assignmentId}/respond`, {
    token: crewToken, body: { status: 'CONFIRMED' },
  });
  check('worker confirms assignment', accept.data?.status === 'CONFIRMED', JSON.stringify(accept.data));

  const mine = await call('GET', '/crew-assignments/worker/me', { token: crewToken });
  check('worker/me returns assignments', mine.data?.length === 1, JSON.stringify(mine.data));
  const row = mine.data[0];
  // Instants, not wall-clock strings: the server cannot know the viewer's
  // timezone, and formatting here showed everyone UTC.
  check('schedule row carries an ISO start instant',
        row?.startAt === '2026-11-20T15:00:00.000Z', row?.startAt);
  check('schedule row carries an ISO end instant',
        row?.endAt === '2026-11-20T18:00:00.000Z', row?.endAt);
  check('schedule row has real location', (row?.location || '').includes('Plaza Hotel'), row?.location);
  check('schedule row has category', row?.category === 'Wedding', row?.category);

  console.log('\n[external invites]');
  const avail = await call(
    'GET', `/crew-assignments/availability/${bookingId}/${workerPublicId}`, { token });
  check('availability lookup finds the creative',
        avail.data?.worker?.workerPublicId === workerPublicId, JSON.stringify(avail.data?.worker));
  check('creative is flagged as being on your team',
        avail.data?.worker?.onYourTeam === true);
  check('already-assigned creative is reported as such',
        avail.data?.alreadyAssigned?.status === 'CONFIRMED',
        JSON.stringify(avail.data?.alreadyAssigned));
  check('conflicts carry instants, not wall clocks',
        avail.data.availability.conflicts.every((c) => !('startTime' in c) && (!c.startAt || c.startAt.endsWith('Z'))),
        JSON.stringify(avail.data.availability.conflicts));

  const dupe = await call('POST', '/crew-assignments', {
    token, body: { bookingId, workerId: crewOnboard.data.user.workerProfileId, role: 'X', agreedFee: 1 } });
  check('the same creative cannot be added twice', dupe.status === 400, JSON.stringify(dupe.data));

  const crewNotes = await call('GET', '/users/notifications', { token: crewToken });
  check('the invited creative was notified',
        crewNotes.data.some((n) => n.type === 'CREW_INVITE'),
        JSON.stringify(crewNotes.data.map((n) => n.type)));

  const badId = await call('GET', `/crew-assignments/availability/${bookingId}/nonsense`, { token });
  check('a malformed creative ID is rejected', badId.status === 400, badId.status);

  const otherStudioPeek = await call(
    'GET', `/crew-assignments/availability/${bookingId}/${workerPublicId}`, { token: crewToken });
  check('a non-admin cannot run the availability lookup',
        otherStudioPeek.status === 403 || otherStudioPeek.status === 400,
        otherStudioPeek.status);

  console.log('\n[finance]');
  const payment = await call('POST', '/finance/client-payments', {
    token, body: { bookingId, amount: 2500, paymentType: 'DEPOSIT' },
  });
  check('client payment without paymentDate -> 201', payment.status === 201, JSON.stringify(payment.data));
  check('paymentDate defaulted server-side', !!payment.data?.paymentDate);

  const expense = await call('POST', '/finance/expenses', {
    token, body: { bookingId, category: 'Equipment Rental', description: 'Second body', amount: 150 },
  });
  check('expense without expenseDate -> 201', expense.status === 201, JSON.stringify(expense.data));
  check('expense description persisted', expense.data?.description === 'Second body');

  const payout = await call('POST', '/finance/worker-payments', {
    token, body: { assignmentId, amount: 600 },
  });
  check('worker payout -> 201', payout.status === 201, JSON.stringify(payout.data));

  // Two bookings exist by now: the wedding (7500) and the inline-client
  // engagement (2200).
  const EXPECTED_REVENUE = 7500 + 2200;
  const EXPECTED_CREW_COST = 1200;
  const EXPECTED_EXPENSES = 150;
  const summary = await call('GET', '/finance/summary', { token });
  check(`summary revenue = ${EXPECTED_REVENUE}`,
        summary.data?.revenue === EXPECTED_REVENUE, JSON.stringify(summary.data));
  check('summary workerCosts counts CONFIRMED work = 1200',
        summary.data?.workerCosts === EXPECTED_CREW_COST, JSON.stringify(summary.data));
  check('summary profit = revenue - crew - expenses',
        summary.data?.studioProfit === EXPECTED_REVENUE - EXPECTED_CREW_COST - EXPECTED_EXPENSES,
        JSON.stringify(summary.data));

  const earnings = await call('GET', '/finance/worker/me', { token: crewToken });
  check('worker earnings counts CONFIRMED assignment', earnings.data?.totalEarned === 1200,
        JSON.stringify(earnings.data));
  check('worker balance = 1200-600 = 600', earnings.data?.currentBalance === 600,
        JSON.stringify(earnings.data));

  console.log('\n[cross-studio isolation]');
  const otherEmail = `other${stamp}@example.com`;
  const otherReg = await call('POST', '/auth/register', {
    body: { email: otherEmail, password, firstName: 'Other', lastName: 'Studio' } });
  const otherOnboard = await call('POST', '/auth/onboarding', {
    token: otherReg.data.access_token,
    body: { role: 'STUDIO', whatsapp: '+998905556677', studioName: 'Rival Studio' } });
  const otherToken = otherOnboard.data.access_token;

  const steal = await call('GET', `/bookings/${bookingId}`, { token: otherToken });
  check("other studio cannot read the booking (404)", steal.status === 404, steal.status);
  const stealDelete = await call('DELETE', `/bookings/${bookingId}`, { token: otherToken });
  check('other studio cannot delete the booking (404)', stealDelete.status === 404, stealDelete.status);
  const stealPayments = await call('GET', `/finance/client-payments/booking/${bookingId}`, { token: otherToken });
  check('other studio cannot read payments (404)', stealPayments.status === 404, stealPayments.status);
  const foreignEdit = await call('PATCH', `/clients/${client.data.id}`, {
    token: otherToken, body: { firstName: 'Hacked' } });
  check("other studio cannot edit this studio's client (404)", foreignEdit.status === 404,
        foreignEdit.status);
  const foreignDelete = await call('DELETE', `/clients/${client.data.id}`, { token: otherToken });
  check("other studio cannot delete this studio's client (404)", foreignDelete.status === 404,
        foreignDelete.status);
  const foreignStatus = await call('PATCH', `/bookings/${bookingId}`, {
    token: otherToken, body: { status: 'CANCELLED' } });
  check("other studio cannot change this booking's status (404)", foreignStatus.status === 404,
        foreignStatus.status);

  const stealTeam = await call('GET', '/users/team', { token: otherToken });
  check('other studio sees only its own team', stealTeam.data?.active?.length === 1,
        JSON.stringify(stealTeam.data?.active?.length));

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
