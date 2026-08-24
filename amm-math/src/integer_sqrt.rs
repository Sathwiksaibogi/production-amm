pub fn integer_sqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    let mut low = 1;
    let mut high = n;
    let mut answer = 1;

    while low <= high {
        let mid = low + (high - low) / 2;
        if mid <= n / mid {
            answer = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    answer
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqrt_of_zero_is_zero() {
        assert_eq!(integer_sqrt(0), 0);
    }

    #[test]
    fn sqrt_of_one_is_one() {
        assert_eq!(integer_sqrt(1), 1);
    }

    #[test]
    fn calculates_small_perfect_squares() {
        assert_eq!(integer_sqrt(4), 2);
        assert_eq!(integer_sqrt(9), 3);
        assert_eq!(integer_sqrt(16), 4);
        assert_eq!(integer_sqrt(25), 5);
        assert_eq!(integer_sqrt(100), 10);
    }

    #[test]
    fn floors_non_perfect_square() {
        assert_eq!(integer_sqrt(2), 1);
        assert_eq!(integer_sqrt(3), 1);
        assert_eq!(integer_sqrt(5), 2);
        assert_eq!(integer_sqrt(15), 3);
        assert_eq!(integer_sqrt(20_000), 141);
    }

    #[test]
    fn calculates_initial_liquidity_example() {
        let product = 100_u128 * 225_u128;

        assert_eq!(integer_sqrt(product), 150);
    }

    #[test]
    fn calculates_non_exact_liquidity_example() {
        let product = 100_u128 * 200_u128;

        assert_eq!(integer_sqrt(product), 141);
    }

    #[test]
    fn handles_large_perfect_square() {
        let root = u64::MAX as u128;
        let n = root * root;

        assert_eq!(integer_sqrt(n), root);
    }

    #[test]
    fn handles_u128_max() {
        let result = integer_sqrt(u128::MAX);

        assert_eq!(result, u64::MAX as u128);
    }

    #[test]
    fn satisfies_floor_sqrt_property_for_sample_values() {
        let values = [
            2_u128,
            3,
            10,
            99,
            100,
            101,
            20_000,
            1_000_000,
            123_456_789,
            u64::MAX as u128,
            u128::MAX,
        ];

        for n in values {
            let r = integer_sqrt(n);

            assert!(r <= n / r, "r must satisfy r^2 <= n: n={n}, r={r}");

            let next = r + 1;

            assert!(
                next > n / next,
                "r must be the greatest valid integer root: n={n}, r={r}"
            );
        }
    }
}
