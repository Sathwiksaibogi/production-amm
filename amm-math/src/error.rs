#[derive(Debug, PartialEq, Eq)]
pub enum AmmMathError {
    ZeroAmount,
    InvalidFee,
    ArithmeticFailure,
    ZeroOutput,
    ZeroReserve,
}
