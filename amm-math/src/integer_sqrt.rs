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
