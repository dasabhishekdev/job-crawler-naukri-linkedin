function attemptsRemaining(cap, countedToday) {
  return Math.max(0, Number(cap || 20) - Number(countedToday || 0));
}

module.exports = { attemptsRemaining };