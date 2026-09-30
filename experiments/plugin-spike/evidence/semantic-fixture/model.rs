pub trait Task {
    fn run(&self) -> u32;
}

#[cfg(feature = "enabled")]
pub fn selected() -> u32 { 7 }

#[cfg(not(feature = "enabled"))]
pub fn selected() -> u32 { 9 }
