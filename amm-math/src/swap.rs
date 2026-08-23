use crate::error::AmmMathError;
use crate::fees::calculate_fees;
#[derive(Debug, PartialEq, Eq)]
pub struct SwapResult {
    fee_amount: u64,
    amount_in_after_fee: u64,
    amount_out: u64,
}

pub fn calculate_swap_output(
    reserve_in: u64,
    reserve_out: u64,
    amount_in: u64,
    fee_bps: u16,
) -> Result<SwapResult, AmmMathError> {
    if reserve_in == 0 || reserve_out == 0 {
        return Err(AmmMathError::ZeroReserve);
    }
    let (fee_amount, amount_in_after_fee) = calculate_fees(amount_in, fee_bps)?;

    let reserve_in_u128 = u128::from(reserve_in);
    let reserve_out_u128 = u128::from(reserve_out);
    let amount_in_after_fee_u128 = u128::from(amount_in_after_fee);

    let numerator = reserve_out_u128 * amount_in_after_fee_u128;
    let denominator = reserve_in_u128 + amount_in_after_fee_u128;

    let amount_out_u128 = numerator / denominator;

    let amount_out = u64::try_from(amount_out_u128).map_err(|_| AmmMathError::ArithmeticFailure)?;

    if amount_out == 0 {
        return Err(AmmMathError::ZeroOutput);
    }

    Ok(SwapResult {
        fee_amount,
        amount_in_after_fee,
        amount_out,
    })
}

