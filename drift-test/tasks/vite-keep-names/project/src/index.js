export class PaymentError extends Error {
  constructor(message, code) {
    super(message)
    this.name = this.constructor.name
    this.code = code
  }
}

export class CardDeclinedError extends PaymentError {}

function normalizeAmountInCents(amount) {
  if (!Number.isInteger(amount) || amount <= 0) throw new PaymentError(`invalid amount ${amount}`, 'invalid_amount')
  return amount
}

export async function chargeCard(card, amount) {
  const cents = normalizeAmountInCents(amount)
  if (card.number.endsWith('0002')) throw new CardDeclinedError('card declined', 'card_declined')
  return { id: `ch_${card.number.slice(-4)}_${cents}`, amount: cents }
}
