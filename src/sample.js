// Made-up names for the demo (open the app with ?demo in the address to load them)
const FIRST = ['Aung', 'Mya', 'Kyaw', 'Thida', 'Zaw', 'Hnin', 'Min', 'Su', 'Htet', 'Ei', 'Wei Ling', 'Jun Jie', 'Mei', 'Ravi', 'Priya', 'Daniel', 'Grace', 'Ahmad', 'Siti', 'Jason', 'Chloe', 'Marcus', 'Rachel', 'Kevin', 'Nora', 'Leo'];
const LAST = ['Tun', 'Win', 'Oo', 'Lwin', 'Tan', 'Lim', 'Ng', 'Wong', 'Kumar', 'Hassan', 'Lee', 'Chen'];
const GROUPS = ['Bride family', 'Groom family', 'Bride friends', 'Groom friends', 'Colleagues'];
export function sampleGuests(n = 130) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ name: `${FIRST[i % FIRST.length]} ${LAST[(i + Math.floor(i / FIRST.length) * 5) % LAST.length]}`, group: GROUPS[Math.floor(i / 10) % GROUPS.length] });
  return out;
}
